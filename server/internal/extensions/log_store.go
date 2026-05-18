package extensions

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

const (
	maxLogBytes     int64 = 50 * 1024 * 1024
	maxLogAgeHours        = 24
)

type LogStore struct {
	dir string
}

func NewLogStore(stateDir string) (*LogStore, error) {
	dir := filepath.Join(stateDir, "logs", "extensions")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir log dir: %w", err)
	}
	ls := &LogStore{dir: dir}
	if err := ls.CleanupExpired(); err != nil {
		return nil, err
	}
	return ls, nil
}

func (s *LogStore) filePath(invocationID string) string {
	name := strings.ReplaceAll(invocationID, string(filepath.Separator), "_")
	return filepath.Join(s.dir, name+".jsonl")
}

func (s *LogStore) AppendBatch(invocationID string, items []proto.CliOutputBatchItem) (bool, error) {
	if len(items) == 0 {
		return true, nil
	}
	fp := s.filePath(invocationID)
	f, err := os.OpenFile(fp, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return false, err
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	for _, it := range items {
		line, err := json.Marshal(struct {
			TS     string `json:"ts"`
			Stream string `json:"stream"`
			Data   string `json:"data"`
			Seq    int64  `json:"seq,omitempty"`
		}{
			TS:     time.Now().UTC().Format(time.RFC3339Nano),
			Stream: it.Stream,
			Data:   it.Data,
			Seq:    it.Seq,
		})
		if err != nil {
			return false, err
		}
		if _, err := w.Write(line); err != nil {
			return false, err
		}
		if err := w.WriteByte('\n'); err != nil {
			return false, err
		}
	}
	if err := w.Flush(); err != nil {
		return false, err
	}
	st, err := f.Stat()
	if err != nil {
		return false, err
	}
	if st.Size() > maxLogBytes {
		_ = os.Remove(fp)
		return false, nil
	}
	return true, nil
}

func (s *LogStore) CleanupExpired() error {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-maxLogAgeHours * time.Hour)
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		fp := filepath.Join(s.dir, ent.Name())
		st, err := ent.Info()
		if err != nil {
			continue
		}
		if st.ModTime().Before(cutoff) || st.Size() > maxLogBytes {
			_ = os.Remove(fp)
		}
	}
	return nil
}
