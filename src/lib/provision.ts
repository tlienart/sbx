import { run, runAsUser, sudoRun } from './exec.ts';
import { logger } from './logger.ts';
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
 * Provisions the session with the pkgx toolchain, shims, and configuration.
 */
export async function provisionSession(
  instanceName: string,
  tools?: string,
  provider = 'google',
): Promise<void> {
  await ensurePkgxOnHost();
  const sessionUser = await getSessionUsername(instanceName);
  const hostUser = await getHostUser();
  const bridgeDir = `/tmp/.sbx_${hostUser}`;

  const profileFiles = ['.zprofile', '.zshenv', '.bash_profile', '.bashrc'];

  const setupScript = `
export PATH="$HOME/.sbx/bin:/usr/local/bin:$PATH"
export PKGX_YES=1
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
  await deployOpenCodeConfig(sessionUser, provider);
}

async function deployShims(sessionUser: string): Promise<void> {
  const baseShim = `
import os
import sys
import socket
import json
import base64

def main():
    command = "COMMAND_PLACEHOLDER"
    socket_path = os.environ.get("BRIDGE_SOCK")
    if not socket_path or not os.path.exists(socket_path):
        os.execvp("pkgx", ["pkgx", command] + sys.argv[1:])

    req = {
        "command": command,
        "args": sys.argv[1:],
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
        os.execvp("pkgx", ["pkgx", command] + sys.argv[1:])

if __name__ == "__main__":
    main()
`.trim();

  const gitShim = baseShim.replace(/COMMAND_PLACEHOLDER/g, 'git');
  const ghShim = baseShim.replace(/COMMAND_PLACEHOLDER/g, 'gh');

  const apiBridge = `
import os
import sys
import socket
import threading

PROXY_SOCK = os.environ.get("PROXY_SOCK")

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
    except:
        tcp_conn.close()

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9999
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(100)
    print(f"API Bridge listening on 127.0.0.1:{port}")
    while True:
        client_conn, _ = server.accept()
        bridge_handler(client_conn, PROXY_SOCK)

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

async function deployOpenCodeConfig(sessionUser: string, provider: string): Promise<void> {
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
          baseURL: 'http://127.0.0.1:9999/google',
          apiKey: 'SBX_PROXY_ACTIVE',
        },
      },
      openai: {
        options: {
          baseURL: 'http://127.0.0.1:9999/openai',
          apiKey: 'SBX_PROXY_ACTIVE',
        },
      },
      anthropic: {
        options: {
          baseURL: 'http://127.0.0.1:9999/anthropic',
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
