import { run, runAsUser, sudoRun } from './exec.ts';
import { logger } from './logger.ts';
import { sudoers } from './sudo.ts';
import { getHostUser, getSessionUsername } from './user.ts';

/**
 * Ensures pkgx is installed on the host system.
 */
async function ensurePkgxOnHost(): Promise<void> {
  try {
    // Check if in PATH or at common absolute path
    await run('bash', ['-c', 'command -v pkgx || ls /usr/local/bin/pkgx']);
    return;
  } catch {
    logger.info('pkgx not found. Installing pkgx host-wide...');
    // We install pkgx to /usr/local/bin so it's available to all users.
    // The installer from pkgx.sh handles this.
    await sudoRun('bash', ['-c', 'curl -Ssf https://pkgx.sh | sh']);
  }
}

/**
 * Ensures the host user has access to the sandbox home directory for bridged commands.
 */
async function ensureHostAccessToSandbox(sessionUser: string): Promise<void> {
  const hostUser = await getHostUser();
  const homeDir = `/Users/${sessionUser}`;

  logger.info(`Granting host user "${hostUser}" access to ${homeDir}...`);

  try {
    // 1. Ensure the directory itself is searchable/traversable for the host user
    await sudoRun('chmod', ['755', homeDir]);

    // 2. Apply ACLs for inheritance so the host can access any subdirectories created by the sandbox.
    // We grant full control to the host user on this path and its children.
    // 'inherited' flag means it applies to existing items if we were using -R,
    // but here we use 'file_inherit,directory_inherit' for future items.
    const acl = `user:${hostUser} allow list,add_file,search,add_subdirectory,delete_child,readsecurity,file_inherit,directory_inherit`;

    // Clear existing ACLs first to avoid duplicates/conflicts
    await sudoRun('chmod', ['-N', homeDir]);
    // Apply new ACL to the home directory
    await sudoRun('chmod', ['+a', acl, homeDir]);

    // 3. For any EXISTING subdirectories, we should ideally apply the ACL too,
    // but to keep it fast we only do it for the top level or known important dirs.
    // Actually, let's just do a shallow ACL grant on existing top-level items.
    await sudoRun('bash', ['-c', `find ${homeDir} -maxdepth 1 -exec chmod +a "${acl}" {} +`]);
  } catch (err: any) {
    logger.warn(`Failed to set ACLs on ${homeDir}: ${err.message}. Bridged commands might fail.`);
  }
}

/**
 * Provisions the session with the pkgx toolchain, shims, and configuration.
 */
export async function provisionSession(
  instanceName: string,
  tools?: string,
  provider = 'google',
  apiPort = 9999,
): Promise<void> {
  await ensurePkgxOnHost();
  const sessionUser = await getSessionUsername(instanceName);

  // Ensure permissions are correct for the host bridge
  await ensureHostAccessToSandbox(sessionUser);

  // Ensure sudoers are configured for non-interactive API access
  await sudoers.setup(instanceName);

  const hostUser = await getHostUser();
  const bridgeDir = `/tmp/.sbx_${hostUser}`;

  const profileFiles = ['.zprofile', '.zshenv', '.bash_profile', '.bashrc'];

  const setupScript = `
export PATH="$HOME/.sbx/bin:/usr/local/bin:$PATH"
export PKGX_YES=1
export TMPDIR="$HOME/tmp"
export BRIDGE_SOCK="${bridgeDir}/bridge.sock"
export PROXY_SOCK="${bridgeDir}/proxy.sock"

# Satisfy LLM SDKs pre-flight checks
export GOOGLE_GENERATIVE_AI_API_KEY="SBX_PROXY_ACTIVE"
export OPENAI_API_KEY="SBX_PROXY_ACTIVE"
export ANTHROPIC_API_KEY="SBX_PROXY_ACTIVE"

# Command not found handlers for pkgx
command_not_found_handler() {
    pkgx "$@"
}
command_not_found_handle() {
    pkgx "$@"
}

# Try pkgx setup for v1 compatibility, ignore errors for v2
pkgx --setup 2>/dev/null | source /dev/stdin 2>/dev/null || true
`.trim();

  for (const file of profileFiles) {
    try {
      const tmpFile = `/tmp/sbx_setup_${instanceName}_${file.replace('.', '')}.sh`;
      await run('bash', ['-c', `cat <<'EOF' > ${tmpFile}\n${setupScript}\nEOF`]);
      await run('chmod', ['644', tmpFile]);
      await runAsUser(
        sessionUser,
        `grep -q "PKGX_YES" ~/${file} 2>/dev/null || cat ${tmpFile} >> ~/${file}`,
      );
      await run('rm', [tmpFile]);
    } catch (err: any) {
      logger.debug(`Failed to configure ${file}: ${err.message}`);
    }
  }

  // Ensure python and opencode are available
  const baseTools = ['python', 'opencode'];

  // Ensure isolated temp directory exists
  await runAsUser(sessionUser, 'mkdir -p ~/tmp && chmod 700 ~/tmp');

  const requestedTools = tools
    ? tools
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];

  const allTools = [...new Set([...baseTools, ...requestedTools])];

  logger.info(`Pre-caching tools for ${sessionUser}: ${allTools.join(', ')}...`);
  for (const tool of allTools) {
    try {
      await runAsUser(sessionUser, `pkgx +${tool} -- true`);
    } catch (err: any) {
      logger.warn(
        `Failed to pre-cache tool "${tool}": ${err.message}. It may still work if available in the sandbox.`,
      );
    }
  }

  // Deploy shims and configuration
  await deployShims(sessionUser);
  await deployOpenCodeConfig(sessionUser, provider, apiPort);
}

async function deployShims(sessionUser: string): Promise<void> {
  const gitShim = `
import os
import sys
import socket
import json
import base64

def main():
    command = "git"
    args = sys.argv[1:]
    
    # Selective bridging: only bridge commands that might need secrets
    remote_ops = {"push", "pull", "fetch", "clone", "ls-remote", "remote"}
    needs_bridge = any(arg in remote_ops for arg in args)
    
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
            while "\\n" in buffer:
                line, buffer = buffer.split("\\n", 1)
                if not line.strip(): continue
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
`.trim();

  const ghShim = `
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
            while "\\n" in buffer:
                line, buffer = buffer.split("\\n", 1)
                if not line.strip(): continue
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
`.trim();

  const apiBridge = `
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
            if not data: break
            target.sendall(data)
    except: pass
    finally:
        try: source.close()
        except: pass
        try: target.close()
        except: pass

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
`.trim();

  const shimDir = `/Users/${sessionUser}/.sbx/bin`;
  await runAsUser(sessionUser, `mkdir -p ${shimDir}`);

  const shims = [
    { name: 'git', content: gitShim, dest: `${shimDir}/git` },
    { name: 'gh', content: ghShim, dest: `${shimDir}/gh` },
    { name: 'api_bridge.py', content: apiBridge, dest: `${shimDir}/api_bridge.py` },
  ];

  for (const shim of shims) {
    const tmpFile = `/tmp/sbx_shim_${shim.name}`;
    await run('bash', [
      '-c',
      `cat <<'EOF' > ${tmpFile}\n#!/usr/bin/env python3\n${shim.content}\nEOF`,
    ]);
    await run('chmod', ['755', tmpFile]);
    await sudoRun('mv', [tmpFile, shim.dest]);
    await sudoRun('chown', [`${sessionUser}:staff`, shim.dest]);
  }
}

async function deployOpenCodeConfig(
  sessionUser: string,
  provider: string,
  apiPort: number,
): Promise<void> {
  const models: Record<string, string> = {
    google: 'google/gemini-3-flash-preview',
    openai: 'openai/gpt-4o',
    anthropic: 'anthropic/claude-3-5-sonnet-latest',
  };

  const config = {
    model: models[provider] || models.google,
    provider: {
      google: {
        options: {
          baseURL: `http://127.0.0.1:${apiPort}/google`,
          apiKey: 'SBX_PROXY_ACTIVE',
        },
      },
      openai: {
        options: {
          baseURL: `http://127.0.0.1:${apiPort}/openai`,
          apiKey: 'SBX_PROXY_ACTIVE',
        },
      },
      anthropic: {
        options: {
          baseURL: `http://127.0.0.1:${apiPort}/anthropic`,
          apiKey: 'SBX_PROXY_ACTIVE',
        },
      },
    },
  };

  const configDir = `/Users/${sessionUser}/.config/opencode`;
  const configFile = `${configDir}/opencode.json`;
  const tmpFile = `/tmp/sbx_opencode_config_${sessionUser}.json`;

  await run('bash', ['-c', `cat <<'EOF' > ${tmpFile}\n${JSON.stringify(config, null, 2)}\nEOF`]);
  await run('chmod', ['644', tmpFile]);

  await runAsUser(sessionUser, `mkdir -p ${configDir}`);
  await sudoRun('mv', [tmpFile, configFile]);
  await sudoRun('chown', [`${sessionUser}:staff`, configFile]);
}
