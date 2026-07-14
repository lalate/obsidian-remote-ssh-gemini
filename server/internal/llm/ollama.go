package llm

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

// OllamaProvider runs the ollama CLI to execute prompts. It expects the
// ollama server to be running on the default port (127.0.0.1:11434).
type OllamaProvider struct {
	binary string
}

// NewOllamaProvider resolves the ollama binary via LookPath.
func NewOllamaProvider() *OllamaProvider {
	return &OllamaProvider{}
}

func (p *OllamaProvider) Name() string    { return "Ollama" }
func (p *OllamaProvider) ToolName() string { return "ollama" }
func (p *OllamaProvider) SessionFieldName() string { return "" }

func (p *OllamaProvider) Command() string {
	if p.binary == "" {
		path, err := exec.LookPath("ollama")
		if err == nil {
			p.binary = path
		}
	}
	return p.binary
}

// Execute runs `ollama run <model> <prompt>` where the model name is
// expected to be the first element of args. sessionID is ignored — ollama
// does not support session continuation.
func (p *OllamaProvider) Execute(ctx context.Context, prompt string, args []string, _ string) (*LlmResponse, error) {
	binary := p.Command()
	if binary == "" {
		return &LlmResponse{Error: "ollama binary not found"}, nil
	}
	if !ollamaServerRunning() {
		return &LlmResponse{Error: "ollama server not running (try: ollama serve)"}, nil
	}

	// Use first arg as model name; default to empty (ollama uses its own default).
	ollamaArgs := []string{"run"}
	if len(args) > 0 && args[0] != "" {
		ollamaArgs = append(ollamaArgs, args[0])
	} else {
		ollamaArgs = append(ollamaArgs, "")
	}
	ollamaArgs = append(ollamaArgs, prompt)

	cmd := exec.CommandContext(ctx, binary, ollamaArgs...)
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

	text := strings.TrimSpace(stdout.String())
	return &LlmResponse{Text: text}, nil
}

// ExecuteStream runs ollama and calls cb with the full response as a single
// chunk. Ollama does not support incremental streaming via the CLI.
func (p *OllamaProvider) ExecuteStream(ctx context.Context, prompt string, args []string, sessionID string, cb StreamCallback) (*LlmResponse, error) {
	resp, err := p.Execute(ctx, prompt, args, sessionID)
	if err != nil {
		return resp, err
	}
	if resp.Text != "" {
		cb(resp.Text, "", false)
	}
	cb("", "", true)
	return resp, nil
}

// Healthy checks whether the ollama binary exists and the server responds.
func (p *OllamaProvider) Healthy(_ context.Context) LlmHealth {
	binary := p.Command()
	if binary == "" {
		return LlmHealth{
			Available: false,
			Running:   false,
			Error:     "ollama not found in PATH",
		}
	}
	fi, err := os.Stat(binary)
	if err != nil || fi.Mode().Perm()&0111 == 0 {
		return LlmHealth{
			Available: false,
			Running:   false,
			Error:     fmt.Sprintf("ollama binary not executable: %s", binary),
		}
	}
	running := ollamaServerRunning()
	errMsg := ""
	if !running {
		errMsg = "ollama server not running (try: ollama serve)"
	}
	return LlmHealth{
		Available: true,
		Running:   running,
		Error:     errMsg,
	}
}

func ollamaServerRunning() bool {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:11434/api/tags")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ListModels calls `ollama list` and returns available models.
func (p *OllamaProvider) ListModels(_ context.Context) ([]proto.LlmModel, error) {
	binary := p.Command()
	if binary == "" {
		return nil, fmt.Errorf("ollama binary not found")
	}
	cmd := exec.Command(binary, "list")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ollama list: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	var models []proto.LlmModel
	lines := strings.Split(stdout.String(), "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if i == 0 && strings.HasPrefix(line, "NAME") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) == 0 {
			continue
		}
		name := parts[0]
		models = append(models, proto.LlmModel{
			ID:       name,
			Provider: "ollama",
			Name:     name,
		})
	}
	return models, nil
}

// ListAgents returns nil — ollama does not support agent listing.
func (p *OllamaProvider) ListAgents(_ context.Context) ([]proto.LlmAgent, error) {
	return nil, nil
}
