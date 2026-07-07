package llm

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// ─── opencode JSON event types ───────────────────────────────────────────────

// openCodeEvent is the top-level discriminator for opencode's JSON event stream
// (--format json). Each line is a JSON object with at least a "type" field.
type openCodeEvent struct {
	Type string          `json:"type"`
	Text *openCodePart   `json:"part,omitempty"`
	Step *openCodeStep   `json:"step,omitempty"`
	Err  *openCodeErr    `json:"error,omitempty"`

	// Raw holds the original line (used for unknown event types).
	Raw json.RawMessage `json:"-"`
}

type openCodePart struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type openCodeStep struct {
	Type   string             `json:"type"`
	Reason string             `json:"reason,omitempty"`
	Tokens *openCodeTokens    `json:"tokens,omitempty"`
	Cost   json.Number        `json:"cost,omitempty"`
}

type openCodeTokens struct {
	Input  int `json:"input"`
	Output int `json:"output"`
}

type openCodeErr struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data,omitempty"`
}

// openCodeResp is the accumulated result from parsing an opencode JSON stream.
type openCodeResp struct {
	Text      string
	CostCents int
	Model     string
	Err       string
}

// parseOpenCodeStream reads a newline-delimited JSON stream from r and
// accumulates text / error / cost events into an openCodeResp.
func parseOpenCodeStream(r io.Reader) (*openCodeResp, error) {
	resp := &openCodeResp{}
	sc := bufio.NewScanner(r)
	sc.Buffer(nil, 256*1024) // 256 KiB max line

	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}

		var ev openCodeEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			// Non-JSON lines (e.g. ASCII-art banners) are silently skipped.
			continue
		}

		switch ev.Type {
		case "text":
			if ev.Text != nil && ev.Text.Type == "text" && ev.Text.Text != "" {
				if resp.Text != "" {
					resp.Text += "\n"
				}
				resp.Text += ev.Text.Text
			}

		case "step_finish":
			if ev.Step != nil {
				if ev.Step.Cost.String() != "" && ev.Step.Cost.String() != "0" {
					costFloat := 0.0
					if err := json.Unmarshal([]byte(ev.Step.Cost.String()), &costFloat); err == nil {
						// Convert dollar cost to cents (round up).
						resp.CostCents = int(costFloat*100 + 0.5)
					}
				}
			}

		case "error":
			if ev.Err != nil {
				msg := ev.Err.Name
				// Attempt to extract a human-readable message from the data.
				if len(ev.Err.Data) > 0 {
					var dataMap map[string]interface{}
					if err := json.Unmarshal(ev.Err.Data, &dataMap); err == nil {
						if m, ok := dataMap["message"].(string); ok && m != "" {
							msg += ": " + m
						}
					}
				}
				if resp.Err == "" {
					resp.Err = msg
				} else {
					resp.Err += "; " + msg
				}
			}

		case "step_start", "tool_use", "tool_result":
			// Ignored — these carry no response text.

		default:
			// Unknown event types are silently skipped.
		}
	}

	if err := sc.Err(); err != nil {
		return resp, fmt.Errorf("read opencode stream: %w", err)
	}
	if resp.Err != "" && resp.Text == "" {
		// If there's an error but no text, return it as an error response.
		return resp, fmt.Errorf("opencode error: %s", resp.Err)
	}
	return resp, nil
}
