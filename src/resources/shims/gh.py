import os
import sys
import socket
import json
import base64


def main():
    command = "gh"
    args = sys.argv[1:]

    # Selective bridging for gh: bridge most things but run help/version locally
    local_only = {"--help", "-h", "--version", "-v"}
    needs_bridge = not any(arg in local_only for arg in args)

    socket_path = os.environ.get("BRIDGE_SOCK")

    if not needs_bridge or not socket_path or not os.path.exists(socket_path):
        os.execvp("pkgx", ["pkgx", command] + args)

    req = {
        "command": command,
        "args": args,
        "cwd": os.getcwd(),
    }

    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.connect(socket_path)
        client.sendall(json.dumps(req).encode("utf-8"))

        buffer = ""
        while True:
            data = client.recv(4096)
            if not data:
                break
            buffer += data.decode("utf-8")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                msg = json.loads(line)
                if msg["type"] == "stdout":
                    sys.stdout.buffer.write(base64.b64decode(msg["data"]))
                    sys.stdout.buffer.flush()
                elif msg["type"] == "stderr":
                    sys.stderr.buffer.write(base64.b64decode(msg["data"]))
                    sys.stderr.buffer.flush()
                elif msg["type"] == "exit":
                    sys.exit(msg["code"])
                elif msg["type"] == "error":
                    print(f"[Shim Error] {msg['message']}", file=sys.stderr)
                    sys.exit(1)
    except Exception as e:
        print(f"[Shim] Failed to connect to bridge: {e}", file=sys.stderr)
        os.execvp("pkgx", ["pkgx", command] + args)


if __name__ == "__main__":
    main()
