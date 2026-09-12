package daemonclient

import (
	"encoding/binary"
	"net"
	"path/filepath"
	"testing"
)

func frame(t byte, payload string) []byte {
	b := make([]byte, 4+1+len(payload))
	binary.BigEndian.PutUint32(b[:4], uint32(1+len(payload)))
	b[4] = t
	copy(b[5:], payload)
	return b
}

// A fake engine that greets the way the real one does: cwd, then identity.
func TestProbeReadsIdentityAfterCwd(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "e.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		conn.Write(frame(MsgCwd, "/home/x"))
		conn.Write(frame(MsgHello, "version=0.3.1 flavor=dev instance=abcd1234 pid=7 node=nonode@nohost sock=/a b/dev.sock"))
	}()

	id, err := Probe(sock)
	if err != nil {
		t.Fatal(err)
	}
	if id.Version != "0.3.1" || id.Flavor != "dev" || id.Instance != "abcd1234" || id.Pid != "7" || id.Socket != "/a b/dev.sock" {
		t.Fatalf("got %+v", id)
	}
}

func TestProbeOldEngineWithoutHello(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "e.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		conn.Write(frame(MsgCwd, "/home/x"))
		conn.Close()
	}()
	id, err := Probe(sock)
	if err != nil || id.Instance != "" {
		t.Fatalf("got %+v %v", id, err)
	}
}

func TestProbeNothingListening(t *testing.T) {
	if _, err := Probe(filepath.Join(t.TempDir(), "none.sock")); err == nil {
		t.Fatal("expected an error")
	}
}
