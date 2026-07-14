package handlers

import (
	"context"
	"encoding/json"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/llm"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

type ProviderInfoHandler struct {
	registry *llm.ProviderRegistry
}

func NewProviderInfoHandler(registry *llm.ProviderRegistry) *ProviderInfoHandler {
	return &ProviderInfoHandler{registry: registry}
}

func (h *ProviderInfoHandler) Handle() rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.ProviderInfoParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, rpc.ErrInvalidParams("invalid params: " + err.Error())
		}
		provider := h.registry.Get(p.Tool)
		if provider == nil {
			return proto.ProviderInfoResult{
				Tool:  p.Tool,
				Error: "unknown provider: " + p.Tool,
			}, nil
		}
		info := h.collectInfo(provider)
		raw, _ := json.Marshal(info)
		return proto.ProviderInfoResult{
			Tool: p.Tool,
			Name: provider.Name(),
			Info: raw,
		}, nil
	}
}

func (h *ProviderInfoHandler) collectInfo(provider llm.LlmProvider) map[string]interface{} {
	info := map[string]interface{}{
		"tool":     provider.ToolName(),
		"command":  provider.Command(),
		"supports": map[string]bool{
			"sessionFieldName": provider.SessionFieldName() != "",
		},
	}
	return info
}
