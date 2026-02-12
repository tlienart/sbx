import os
import sys
import socket
import threading
import time


def log(msg):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {msg}", file=sys.stderr)
    sys.stderr.flush()


def pipe(source, target):
    try:
        while True:
            data = source.recv(8192)
            if not data:
                break
            target.sendall(data)
    except:
        pass
    finally:
        try:
            source.close()
        except:
            pass
        try:
            target.close()
        except:
            pass


def bridge_handler(tcp_conn, unix_sock_path):
    try:
        unix_conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        unix_conn.connect(unix_sock_path)
        threading.Thread(target=pipe, args=(tcp_conn, unix_conn), daemon=True).start()
        threading.Thread(target=pipe, args=(unix_conn, tcp_conn), daemon=True).start()
    except Exception as e:
        log(f"Failed to connect to unix socket {unix_sock_path}: {e}")
        tcp_conn.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9999
    proxy_sock = os.environ.get("PROXY_SOCK")

    if not proxy_sock:
        log("Error: PROXY_SOCK environment variable not set")
        sys.exit(1)

    log(f"Starting API Bridge on 127.0.0.1:{port}")
    log(f"Target Proxy Socket: {proxy_sock}")

    if not os.path.exists(proxy_sock):
        log(f"Warning: Proxy socket not found at {proxy_sock}. It may appear later.")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("127.0.0.1", port))
    except Exception as e:
        log(f"Error: Failed to bind to port {port}: {e}")
        sys.exit(1)

    server.listen(100)
    log(f"API Bridge listening on 127.0.0.1:{port}")

    while True:
        try:
            client_conn, addr = server.accept()
            # Re-read PROXY_SOCK in case it changed (though unlikely)
            current_proxy_sock = os.environ.get("PROXY_SOCK", proxy_sock)
            bridge_handler(client_conn, current_proxy_sock)
        except KeyboardInterrupt:
            break
        except Exception as e:
            log(f"Error in accept loop: {e}")


if __name__ == "__main__":
    main()
