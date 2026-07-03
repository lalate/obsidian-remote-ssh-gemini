VERSION ?= $(shell git describe --tags --dirty --always 2>/dev/null || echo "0.0.0-dev")
LDFLAGS := -X main.Version=$(VERSION)

CMD       := ./cmd/obsidian-remote-server
CMD_RELAY := ./cmd/obsidian-remote-relay-health
BIN_DIR   := bin
DIST_DIR  := dist

# Fully static binaries: CGO off so the daemon links no libc and runs on
# ANY Linux glibc version. Without this, the host-native build in `cross`
# (linux/amd64 on a modern ubuntu-latest runner, glibc 2.35+) is the only
# target Go builds with CGO auto-ENABLED — it links dynamically against the
# runner's glibc and then dies on older hosts with
# `libc.so.6: version GLIBC_2.34 not found`. The daemon never writes its
# token, RPC times out, and the client falls back to SFTP. The cross
# (non-host) targets already default to CGO off; exporting it here makes all
# targets consistent and static. Mirrors plugin/scripts/build-server.mjs.
export CGO_ENABLED := 0

.PHONY: build clean cross test fmt

build:
	go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/obsidian-remote-server $(CMD)
	go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/obsidian-remote-relay-health $(CMD_RELAY)

cross:
	mkdir -p $(DIST_DIR)
	GOOS=linux  GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-server-linux-amd64  $(CMD)
	GOOS=linux  GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-server-linux-arm64  $(CMD)
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-server-darwin-amd64 $(CMD)
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-server-darwin-arm64 $(CMD)
	GOOS=linux  GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-relay-health-linux-amd64  $(CMD_RELAY)
	GOOS=linux  GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/obsidian-remote-relay-health-linux-arm64  $(CMD_RELAY)

test:
	go test ./...

fmt:
	gofmt -w .

clean:
	rm -rf $(BIN_DIR) $(DIST_DIR)
