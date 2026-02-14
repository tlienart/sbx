import { Resources } from '../common/Resources.ts';
import { getOS } from '../common/os/index.ts';
import type { IIdentityManager } from '../identity/IdentityManager.ts';
import { logger } from '../logger.ts';

export class Provisioner {
  private os = getOS();

  constructor(private identity: IIdentityManager) {}

  /**
   * Ensures pkgx is installed on the host system.
   */
  async ensurePkgxOnHost(): Promise<void> {
    try {
      // Check if in PATH or at common absolute path
      await this.os.proc.run('bash', ['-c', 'command -v pkgx || ls /usr/local/bin/pkgx']);
      return;
    } catch {
      logger.info('pkgx not found. Installing pkgx host-wide...');
      await this.os.proc.sudo('bash', ['-c', 'curl -Ssf https://pkgx.sh | sh']);
    }
  }

  /**
   * Provisions the session with the pkgx toolchain, shims, and configuration.
   */
  async provisionSession(
    instanceName: string,
    tools?: string,
    provider = 'google',
    apiPort = 9999,
    proxyPort?: number,
  ): Promise<void> {
    await this.ensurePkgxOnHost();
    const sessionUser = await this.identity.getSessionUsername(instanceName);
    const hostUser = await this.identity.getHostUser();
    const bridgeDir = `/tmp/.sbx_${hostUser}`;

    const profileFiles = ['.zprofile', '.zshenv', '.bash_profile', '.bashrc'];

    const proxyScript = proxyPort
      ? `
export HTTP_PROXY="http://127.0.0.1:${proxyPort}"
export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"
export http_proxy="http://127.0.0.1:${proxyPort}"
export https_proxy="http://127.0.0.1:${proxyPort}"
export NO_PROXY="localhost,127.0.0.1"
export no_proxy="localhost,127.0.0.1"
`.trim()
      : '';

    const setupScript = `
export PATH="$HOME/.sbx/bin:/usr/local/bin:$PATH"
export PKGX_YES=1
export TMPDIR="$HOME/tmp"
export BRIDGE_SOCK="${bridgeDir}/bridge.sock"
export PROXY_SOCK="${bridgeDir}/proxy.sock"

${proxyScript}

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
        this.os.fs.write(tmpFile, setupScript);
        await this.os.proc.run('chmod', ['644', tmpFile]);

        const homeFile = `/Users/${sessionUser}/${file}`;

        // Ensure file exists or use touch via su
        await this.os.proc.runAsUser(sessionUser, `touch ${homeFile}`);

        await this.os.proc.runAsUser(
          sessionUser,
          `grep -q "PKGX_YES" ${homeFile} 2>/dev/null || cat ${tmpFile} >> ${homeFile}`,
        );
        await this.os.proc.run('rm', [tmpFile]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug(`Failed to configure ${file}: ${msg}`);
      }
    }

    // Ensure isolated temp directory exists
    await this.os.proc.runAsUser(sessionUser, 'mkdir -p ~/tmp && chmod 700 ~/tmp');

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
        await this.os.proc.runAsUser(sessionUser, `pkgx +${tool} -- true`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Failed to pre-cache tool "${tool}": ${msg}. It may still work if available in the sandbox.`,
        );
      }
    }

    await this.deployShims(sessionUser);
    await this.deployOpenCodeConfig(sessionUser, provider, apiPort);
  }

  async deployShims(sessionUser: string): Promise<void> {
    const shimDir = `/Users/${sessionUser}/.sbx/bin`;
    await this.os.proc.sudo('mkdir', ['-p', shimDir]);
    await this.os.proc.sudo('chown', [`${sessionUser}:staff`, `/Users/${sessionUser}/.sbx`]);
    await this.os.proc.sudo('chown', [`${sessionUser}:staff`, shimDir]);

    const shims = [
      { name: 'git', source: 'git.py', dest: `${shimDir}/git` },
      { name: 'gh', source: 'gh.py', dest: `${shimDir}/gh` },
      { name: 'api_bridge.py', source: 'api_bridge.py', dest: `${shimDir}/api_bridge.py` },
    ];

    for (const shim of shims) {
      const tmpFile = `/tmp/sbx_shim_${sessionUser}_${shim.name}`;
      const content = Resources.getShim(shim.source);

      this.os.fs.write(tmpFile, `#!/usr/bin/env python3\n${content}`);
      await this.os.proc.run('chmod', ['755', tmpFile]);
      await this.os.proc.sudo('mv', [tmpFile, shim.dest]);

      await this.os.proc.sudo('chown', [`${sessionUser}:staff`, shim.dest]);
    }
  }

  async deployOpenCodeConfig(
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

    this.os.fs.write(tmpFile, JSON.stringify(config, null, 2));
    await this.os.proc.run('chmod', ['644', tmpFile]);

    await this.os.proc.runAsUser(sessionUser, `mkdir -p ${configDir}`);
    await this.os.proc.sudo('mv', [tmpFile, configFile]);
    await this.os.proc.sudo('chown', [`${sessionUser}:staff`, configFile]);
  }
}
