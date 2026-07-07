package llm

import (
	"context"
)

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
	Execute(ctx context.Context, prompt string, args []string) (*LlmResponse, error)

	// Healthy probes whether the provider is installed and (if applicable)
	// its server process is reachable.
	Healthy(ctx context.Context) LlmHealth
}

// LlmResponse holds the result of a single LLM execution.
type LlmResponse struct {
	Text      string `json:"text"`
	CostCents int    `json:"costCents,omitempty"`
	Model     string `json:"model,omitempty"`
	Error     string `json:"error,omitempty"`
}

// LlmHealth describes the current availability of a provider.
type LlmHealth struct {
	Available  bool   `json:"available"`
	Running    bool   `json:"running"`
	Error      string `json:"error,omitempty"`
	ServerPort int    `json:"serverPort,omitempty"`
}
