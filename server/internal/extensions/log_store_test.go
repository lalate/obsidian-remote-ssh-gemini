package extensions

import (
	"testing"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

func TestLogStore_ReplayFrom(t *testing.T) {
	tmp := t.TempDir()
	store, err := NewLogStore(tmp)
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}
	inv := "inv-test-1"
	ok, err := store.AppendBatch(inv, []proto.CliOutputBatchItem{
		{Stream: "stdout", Data: "line1\n", Seq: 1},
		{Stream: "stdout", Data: "line2\n", Seq: 2},
		{Stream: "stderr", Data: "line3\n", Seq: 3},
	})
	if err != nil || !ok {
		t.Fatalf("AppendBatch: ok=%v err=%v", ok, err)
	}

	items, found, err := store.ReplayFrom(inv, 1)
	if err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	if !found {
		t.Fatalf("ReplayFrom found=false, want true")
	}
	if len(items) != 2 {
		t.Fatalf("len(items)=%d, want 2", len(items))
	}
	if items[0].Seq != 2 || items[1].Seq != 3 {
		t.Fatalf("unexpected seqs: %+v", items)
	}
}

func TestLogStore_ReplayFrom_NotFound(t *testing.T) {
	tmp := t.TempDir()
	store, err := NewLogStore(tmp)
	if err != nil {
		t.Fatalf("NewLogStore: %v", err)
	}
	items, found, err := store.ReplayFrom("inv-missing", 0)
	if err != nil {
		t.Fatalf("ReplayFrom: %v", err)
	}
	if found {
		t.Fatalf("ReplayFrom found=true, want false")
	}
	if len(items) != 0 {
		t.Fatalf("len(items)=%d, want 0", len(items))
	}

}
