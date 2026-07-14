package llm

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// openCodeEvent is the top-level discriminator for opencode's JSON event stream
// (--format json). Each line is a JSON object with at least a "type" field.
type openCodeEvent struct {
	Type      string        `json:"type"`
	SessionID string        `json:"sessionID,omitempty"`
	Text      *openCodePart `json:"part,omitempty"`
	Step      *openCodeStep `json:"step,omitempty"`
	Err       *openCodeErr  `json:"error,omitempty"`

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
	SessionID string
}

// parseOpenCodeStream reads a newline-delimited JSON stream from r and
// accumulates text / error / cost events into an openCodeResp.
func parseOpenCodeStream(r io.Reader) (*openCodeResp, error) {
	return processOpenCodeStream(r, nil)
}

// processOpenCodeStream reads a newline-delimited JSON stream from r and
// fires cb for each text event as it arrives. The final accumulated
// openCodeResp is returned as with parseOpenCodeStream.
// When cb is nil this behaves identically to parseOpenCodeStream.
func processOpenCodeStream(r io.Reader, cb StreamCallback) (*openCodeResp, error) {
	resp := &openCodeResp{}
	sc := bufio.NewScanner(r)
	sc.Buffer(nil, 256*1024)

	lineNo := 0
	firstText := true
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}

		var ev openCodeEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}

		switch ev.Type {
		case "text":
			if ev.Text != nil && ev.Text.Type == "text" && ev.Text.Text != "" {
				sep := ""
				if !firstText {
					sep = "\n"
				}
				firstText = false
				resp.Text += sep + ev.Text.Text
				if cb != nil {
					cb(sep+ev.Text.Text, resp.SessionID, false)
				}
			}

		case "step_finish":
			if ev.Step != nil {
				if ev.Step.Cost.String() != "" && ev.Step.Cost.String() != "0" {
					costFloat := 0.0
					if err := json.Unmarshal([]byte(ev.Step.Cost.String()), &costFloat); err == nil {
						resp.CostCents = int(costFloat*100 + 0.5)
					}
				}
			}
			if cb != nil {
				cb("", resp.SessionID, true)
			}

		case "error":
			if ev.Err != nil {
				msg := ev.Err.Name
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

		case "step_start":
			if resp.SessionID == "" && ev.SessionID != "" {
				resp.SessionID = ev.SessionID
				if cb != nil {
					cb("", ev.SessionID, false)
				}
			}

		case "tool_use", "tool_result":
		default:
		}
	}

	if err := sc.Err(); err != nil {
		return resp, fmt.Errorf("read opencode stream: %w", err)
	}
	if resp.Err != "" && resp.Text == "" {
		return resp, fmt.Errorf("opencode error: %s", resp.Err)
	}
	return resp, nil
}
