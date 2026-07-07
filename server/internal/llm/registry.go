package llm

// ProviderRegistry holds all registered LLM providers and exposes lookup
// by tool name. Thread-safe after construction (read-only).
type ProviderRegistry struct {
	byTool map[string]LlmProvider
	all    []LlmProvider
}

// NewRegistry creates a registry populated with the given providers.
func NewRegistry(providers ...LlmProvider) *ProviderRegistry {
	r := &ProviderRegistry{
		byTool: make(map[string]LlmProvider),
	}
	for _, p := range providers {
		r.byTool[p.ToolName()] = p
		r.all = append(r.all, p)
	}
	return r
}

// Get looks up a provider by its tool name. Returns nil when not found.
func (r *ProviderRegistry) Get(toolName string) LlmProvider {
	return r.byTool[toolName]
}

// All returns every registered provider.
func (r *ProviderRegistry) All() []LlmProvider {
	return r.all
}

// Default returns the first registered provider, or nil when empty.
func (r *ProviderRegistry) Default() LlmProvider {
	if len(r.all) == 0 {
		return nil
	}
	return r.all[0]
}
