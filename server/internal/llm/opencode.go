package llm

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
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

// serveAddr returns "ws://host:port" or "" when serve is not reachable.
func (p *OpenCodeProvider) serveAddr() string {
	if port := p.discoverServePort(); port > 0 {
		return fmt.Sprintf("ws://%s:%d", p.serveHost, port)
	}
	return ""
}

// Execute runs `opencode run --attach <addr> --format json --auto --pure <prompt>`
// and parses the JSON event stream for the response text.
func (p *OpenCodeProvider) Execute(ctx context.Context, prompt string, args []string) (*LlmResponse, error) {
	binary := p.Command()
	if binary == "" {
		return &LlmResponse{Error: "opencode binary not found"}, nil
	}

	addr := p.serveAddr()
	if addr == "" {
		return &LlmResponse{Error: "opencode serve not running"}, nil
	}

	fullArgs := []string{"run", "--attach", addr, "--format", "json", "--auto", "--pure"}
	fullArgs = append(fullArgs, args...)
	fullArgs = append(fullArgs, prompt)

	cmd := exec.CommandContext(ctx, binary, fullArgs...)
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
