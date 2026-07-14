package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

// OpenCodeProvider runs the opencode binary with --format json and parses the
// JSON event stream to extract response text and cost information.
type OpenCodeProvider struct {
	binary    string
	serveHost string // e.g. "127.0.0.1"
	servePort int    // discovered opencode serve port, or 0
}

// NewOpenCodeProvider resolves the opencode binary via LookPath and returns a
// provider ready for use. When binary cannot be found the provider still
// exists but will report !Available on every health check.
func NewOpenCodeProvider() *OpenCodeProvider {
	return &OpenCodeProvider{
		serveHost: "127.0.0.1",
	}
}

func (p *OpenCodeProvider) Name() string     { return "OpenCode" }
func (p *OpenCodeProvider) ToolName() string  { return "opencode" }
func (p *OpenCodeProvider) SessionFieldName() string { return "ai_opencode_session" }

func (p *OpenCodeProvider) Command() string {
	if p.binary == "" {
		path, err := exec.LookPath("opencode")
		if err == nil {
			p.binary = path
		}
	}
	return p.binary
}

// discoverServePort scans common ports to find a running opencode serve
// instance. Caches the result so repeated calls are cheap.
func (p *OpenCodeProvider) discoverServePort() int {
	if p.servePort != 0 {
		return p.servePort
	}
	for _, port := range []int{4096, 4097, 4098, 4099} {
		addr := net.JoinHostPort(p.serveHost, fmt.Sprintf("%d", port))
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err != nil {
			continue
		}
		conn.Close()
		// Verify it's actually opencode serve (health endpoint).
		url := fmt.Sprintf("http://%s/health", addr)
		client := &http.Client{Timeout: 500 * time.Millisecond}
		resp, hErr := client.Get(url)
		if hErr == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			p.servePort = port
			return port
		}
		if resp != nil {
			resp.Body.Close()
		}
	}
	return 0
}

// serveHTTPAddr returns "http://host:port" or "" when serve is not reachable.
// The opencode CLI's --attach flag expects an HTTP URL, not a WebSocket URL.
func (p *OpenCodeProvider) serveHTTPAddr() string {
	if port := p.discoverServePort(); port > 0 {
		return fmt.Sprintf("http://%s:%d", p.serveHost, port)
	}
	return ""
}

// buildArgs builds the common opencode CLI arguments.
func (p *OpenCodeProvider) buildArgs(sessionID string, args []string, prompt string) (string, []string, error) {
	binary := p.Command()
	if binary == "" {
		return "", nil, fmt.Errorf("opencode binary not found")
	}
	addr := p.serveHTTPAddr()
	if addr == "" {
		return "", nil, fmt.Errorf("opencode serve not running")
	}
	fullArgs := []string{"run", "--attach", addr, "--format", "json", "--pure"}
	if sessionID != "" {
		fullArgs = append(fullArgs, "--session", sessionID)
	}
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, "--", prompt)
	return binary, fullArgs, nil
}

// Execute runs `opencode run --attach <http-addr> --format json --pure` with
// optional `--session` for continuing a prior conversation, and parses the
// JSON event stream for the response text and session ID.
func (p *OpenCodeProvider) Execute(ctx context.Context, prompt string, args []string, sessionID string, workDir string) (*LlmResponse, error) {
	binary, fullArgs, err := p.buildArgs(sessionID, args, prompt)
	if err != nil {
		return &LlmResponse{Error: err.Error()}, nil
	}

	cmd := exec.CommandContext(ctx, binary, fullArgs...)
	if workDir != "" {
		cmd.Dir = workDir
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = err.Error()
		}
		return &LlmResponse{Error: errText}, nil
	}

	resp, parseErr := parseOpenCodeStream(&stdout)
	if parseErr != nil {
		return &LlmResponse{Error: parseErr.Error()}, nil
	}
	if resp.Err != "" {
		return &LlmResponse{Error: resp.Err}, nil
	}

	return &LlmResponse{
		Text:      resp.Text,
		CostCents: resp.CostCents,
		SessionID: resp.SessionID,
	}, nil
}

// ExecuteStream runs opencode and calls cb incrementally as text chunks
// arrive from the JSON event stream. Uses StdoutPipe for real-time reading.
func (p *OpenCodeProvider) ExecuteStream(ctx context.Context, prompt string, args []string, sessionID string, cb StreamCallback, workDir string) (*LlmResponse, error) {
	binary, fullArgs, err := p.buildArgs(sessionID, args, prompt)
	if err != nil {
		return &LlmResponse{Error: err.Error()}, nil
	}

	cmd := exec.CommandContext(ctx, binary, fullArgs...)
	if workDir != "" {
		cmd.Dir = workDir
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return &LlmResponse{Error: fmt.Sprintf("stdout pipe: %v", err)}, nil
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = err.Error()
		}
		return &LlmResponse{Error: errText}, nil
	}

	// Read JSON stream incrementally as opencode writes it.
	resp, parseErr := processOpenCodeStream(stdout, cb)

	// Wait for process to finish.
	waitErr := cmd.Wait()

	if parseErr != nil {
		return &LlmResponse{Error: parseErr.Error()}, nil
	}
	if resp.Err != "" {
		return &LlmResponse{Error: resp.Err}, nil
	}
	if waitErr != nil {
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = waitErr.Error()
		}
		return &LlmResponse{Error: errText}, nil
	}

	return &LlmResponse{
		Text:      resp.Text,
		CostCents: resp.CostCents,
		SessionID: resp.SessionID,
	}, nil
}

// Healthy checks whether the opencode binary exists and, if a server port has
// been discovered, whether the health endpoint responds.
func (p *OpenCodeProvider) Healthy(_ context.Context) LlmHealth {
	binary := p.Command()
	if binary == "" {
		return LlmHealth{
			Available: false,
			Running:   false,
			Error:     "opencode not found in PATH",
		}
	}

	// Verify binary is executable.
	fi, err := os.Stat(binary)
	if err != nil || fi.Mode().Perm()&0111 == 0 {
		return LlmHealth{
			Available: false,
			Running:   false,
			Error:     fmt.Sprintf("opencode binary not executable: %s", binary),
		}
	}

	port := p.discoverServePort()
	running := port > 0
	errMsg := ""
	if !running {
		errMsg = "opencode serve not running (start with: opencode serve)"
	}

	return LlmHealth{
		Available:  true,
		Running:    running,
		Error:      errMsg,
		ServerPort: port,
	}
}

// openCodeModelRaw mirrors the JSON shape of `opencode models --verbose`.
type openCodeModelRaw struct {
	ID         string `json:"id"`
	ProviderID string `json:"providerID"`
	Name       string `json:"name"`
}

// ListModels calls `opencode models --verbose` and returns available models.
func (p *OpenCodeProvider) ListModels(_ context.Context) ([]proto.LlmModel, error) {
	binary := p.Command()
	if binary == "" {
		return nil, fmt.Errorf("opencode binary not found")
	}
	cmd := exec.Command(binary, "models", "--verbose")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("opencode models: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	var models []proto.LlmModel
	dec := json.NewDecoder(&stdout)
	for dec.More() {
		var raw openCodeModelRaw
		if err := dec.Decode(&raw); err != nil {
			break
		}
		provider := raw.ProviderID
		if provider == "" {
			provider = "opencode"
		}
		models = append(models, proto.LlmModel{
			ID:       raw.ID,
			Provider: provider,
			Name:     raw.Name,
		})
	}
	if models == nil {
		// Try reading line-by-line for non-JSON output.
		lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			models = append(models, proto.LlmModel{
				ID:       line,
				Provider: "opencode",
			})
		}
	}
	return models, nil
}

// ListAgents calls `opencode agent list` and returns available agents.
func (p *OpenCodeProvider) ListAgents(_ context.Context) ([]proto.LlmAgent, error) {
	binary := p.Command()
	if binary == "" {
		return nil, fmt.Errorf("opencode binary not found")
	}
	cmd := exec.Command(binary, "agent", "list")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("opencode agent list: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	var agents []proto.LlmAgent
	for _, line := range strings.Split(stdout.String(), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name := line
		role := ""
		if idx := strings.Index(line, " ("); idx > 0 && strings.HasSuffix(line, ")") {
			name = line[:idx]
			role = line[idx+2 : len(line)-1]
		}
		agents = append(agents, proto.LlmAgent{
			Name: name,
			Role: role,
		})
	}
	return agents, nil
}
