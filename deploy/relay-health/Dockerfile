FROM golang:1.25-alpine AS builder
WORKDIR /src

COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download

COPY server ./server
ARG VERSION=0.0.0-dev
RUN cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags "-X main.Version=${VERSION}" \
  -o /out/obsidian-remote-relay-health ./cmd/obsidian-remote-relay-health

FROM alpine:3.22
RUN adduser -D -H -s /sbin/nologin app
USER app
WORKDIR /app
COPY --from=builder /out/obsidian-remote-relay-health /usr/local/bin/obsidian-remote-relay-health
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/obsidian-remote-relay-health"]
