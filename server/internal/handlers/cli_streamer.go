package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

/**
 * cliStreamer manages the output of a spawned CLI process.
 * It supports:
 * 1. JSONL logging for session persistence (when persist=true).
 * 2. Sequence numbers for order guarantee.
 * 3. Throttling/batching of output notifications to reduce network noise.
 * 4. Re-attachment and resumption from a specific sequence number.
 */
type cliStreamer struct {
	id      string
	persist bool
	logFile *os.File

	mu      sync.Mutex
	session *server.Session
	seq     int
	batch   []proto.CliOutputParams
	done    bool
}

func newCliStreamer(session *server.Session, id string, persist bool) (*cliStreamer, error) {
	s := &cliStreamer{
		session: session,
		id:      id,
		persist: persist,
	}
	if persist {
		logPath := filepath.Join(os.TempDir(), fmt.Sprintf("obsidian-cli-%s.jsonl", id))
		// Use O_TRUNC to start fresh for a new spawn. 
		f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			return nil, err
		}
		s.logFile = f
	}
	return s, nil
}

func (s *cliStreamer) Start() {
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			s.mu.Lock()
			if s.done && len(s.batch) == 0 {
				s.mu.Unlock()
				return
			}
			s.flushLocked()
			s.mu.Unlock()
		}
	}()
}

func (s *cliStreamer) UpdateSession(session *server.Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.session = session
}

func (s *cliStreamer) flushLocked() {
	if len(s.batch) == 0 || s.session == nil {
		return
	}
	_ = s.session.SendNotification("cli.output.batch", proto.CliOutputBatchParams{
		Chunks: s.batch,
	})
	s.batch = nil
}

func (s *cliStreamer) HandleChunk(streamName string, data string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := proto.CliOutputParams{
		ID:     s.id,
		Stream: streamName,
		Data:   data,
		Seq:    s.seq,
	}
	s.seq++

	if s.logFile != nil {
		line, _ := json.Marshal(p)
		_, _ = s.logFile.Write(append(line, '\n'))
	}

	if s.session != nil {
		_ = s.session.SendNotification("cli.output", p)
	}

	s.batch = append(s.batch, p)
	if len(s.batch) >= 50 {
		s.flushLocked()
	}
}

func (s *cliStreamer) Stream(streamName string, r io.Reader) {
	// Line-buffered scanning is a good default for Gemini/git output.
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		s.HandleChunk(streamName, scanner.Text()+"\n")
	}
}

func (s *cliStreamer) Resume(session *server.Session, from int) {
	s.mu.Lock()
	s.session = session
	id := s.id
	s.mu.Unlock()

	if !s.persist {
		return
	}

	logPath := filepath.Join(os.TempDir(), fmt.Sprintf("obsidian-cli-%s.jsonl", id))
	f, err := os.Open(logPath)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var chunks []proto.CliOutputParams
	currentSeq := 0
	for scanner.Scan() {
		if currentSeq >= from {
			var p proto.CliOutputParams
			if err := json.Unmarshal(scanner.Bytes(), &p); err == nil {
				chunks = append(chunks, p)
				if len(chunks) >= 50 {
					_ = session.SendNotification("cli.output.batch", proto.CliOutputBatchParams{
						Chunks: chunks,
					})
					chunks = nil
				}
			}
		}
		currentSeq++
	}

	if len(chunks) > 0 {
		_ = session.SendNotification("cli.output.batch", proto.CliOutputBatchParams{
			Chunks: chunks,
		})
	}
}

func (s *cliStreamer) Close() {
	s.mu.Lock()
	s.done = true
	s.flushLocked()
	if s.logFile != nil {
		_ = s.logFile.Close()
	}
	s.mu.Unlock()
}
