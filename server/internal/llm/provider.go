package llm

import (
	"context"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

// StreamCallback is called incrementally as the LLM generates text chunks.
// sessionID is set on the first call (from step_start events). When done is
// true, the stream is complete and no more callbacks will be issued.
type StreamCallback func(chunk string, sessionID string, done bool)

// LlmProvider abstracts an LLM execution backend (opencode, ollama, etc.)
// behind a common interface. Each provider knows its own binary path, CLI
// flags, output format, and health-check logic.
type LlmProvider interface {
	// Name returns a human-readable identifier for this provider
	// (e.g. "opencode", "ollama").
	Name() string

	// ToolName returns the binary name used for capabilities-file matching.
	ToolName() string

	// Command returns the resolved absolute path to the binary, or "" if
	// the binary could not be found.
	Command() string

	// Execute runs the LLM with the given prompt. args are additional
	// provider-specific CLI flags supplied by the user (e.g. model name).
	// sessionID is an optional opencode session ID for continuing a previous
	// conversation; providers that don't support session continuation ignore it.
	Execute(ctx context.Context, prompt string, args []string, sessionID string, workDir string) (*LlmResponse, error)

	// ExecuteStream runs the LLM and calls cb incrementally as text chunks
	// are generated. The final LlmResponse is returned as with Execute.
	// Providers that don't support streaming fall back to calling Execute
	// once and emitting the full response as a single chunk.
	ExecuteStream(ctx context.Context, prompt string, args []string, sessionID string, cb StreamCallback, workDir string) (*LlmResponse, error)

	// Healthy probes whether the provider is installed and (if applicable)
	// its server process is reachable.
	Healthy(ctx context.Context) LlmHealth

	// ListModels returns the available models for this provider.
	// Providers that don't support model listing return nil.
	ListModels(ctx context.Context) ([]proto.LlmModel, error)

	// ListAgents returns the available agents for this provider.
	// Providers that don't support agent listing return nil.
	ListAgents(ctx context.Context) ([]proto.LlmAgent, error)

	// SessionFieldName returns the frontmatter field name for provider-specific
	// session IDs (e.g., "ai_opencode_session"). Empty string means the provider
	// doesn't produce provider-specific session fields.
	SessionFieldName() string
}

// LlmResponse holds the result of a single LLM execution.
type LlmResponse struct {
	Text      string `json:"text"`
	CostCents int    `json:"costCents,omitempty"`
	Model     string `json:"model,omitempty"`
	Error     string `json:"error,omitempty"`
	SessionID string `json:"sessionID,omitempty"`
}

// LlmHealth describes the current availability of a provider.
type LlmHealth struct {
	Available  bool   `json:"available"`
	Running    bool   `json:"running"`
	Error      string `json:"error,omitempty"`
	ServerPort int    `json:"serverPort,omitempty"`
}
