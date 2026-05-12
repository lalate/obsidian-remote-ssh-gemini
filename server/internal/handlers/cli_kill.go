package handlers

import (
	"context"
	"encoding/json"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
)

// CliKill terminates a running process started via cli.spawn.
func CliKill() rpc.Handler {
	return func(ctx context.Context, params json.RawMessage) (interface{}, *rpc.Error) {
		var p proto.CliKillParams
		if e := decodeParams("cli.kill", params, &p); e != nil {
			return nil, e
		}
		if p.ID == "" {
			return nil, rpc.ErrInvalidParams("cli.kill: id is required")
		}

		proc, ok := getCliProcess(p.ID)
		if !ok {
			return nil, rpc.ErrInvalidParams("cli.kill: unknown id: " + p.ID)
		}
		if err := killProcess(ctx, proc); err != nil {
			return nil, rpc.ErrInternal("cli.kill: " + err.Error())
		}

		return struct{}{}, nil
	}
}
