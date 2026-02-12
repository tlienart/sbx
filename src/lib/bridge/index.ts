import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';
import { ApiProxy } from './ApiProxy.ts';
import { CommandBridge } from './CommandBridge.ts';
import { SecretManager } from './SecretManager.ts';

export class BridgeBox {
  public secrets: SecretManager;
  private commandBridge: CommandBridge;
  private apiProxy: ApiProxy;

  constructor(hostUser: string, sandboxUser?: string) {
    this.secrets = new SecretManager();
    this.commandBridge = new CommandBridge(hostUser, this.secrets, sandboxUser);
    this.apiProxy = new ApiProxy(hostUser, this.secrets, sandboxUser);
  }

  async start() {
    await Promise.all([this.commandBridge.start(), this.apiProxy.start()]);
  }

  stop() {
    this.commandBridge.stop();
    this.apiProxy.stop();
  }

  getSocketPaths() {
    return {
      command: this.commandBridge.getSocketPath(),
      proxy: this.apiProxy.getSocketPath(),
    };
  }

  async attachToSandbox(username: string, port: number): Promise<void> {
    const os = getOS();
    if (os.env.get('SKIP_PROVISION')) {
      logger.debug(`[BridgeBox] Mock skipping attach to ${username} on port ${port}`);
      return;
    }

    const sandboxLogDir = `/Users/${username}/.sbx/logs`;
    const env = {
      BRIDGE_SOCK: this.getSocketPaths().command,
      PROXY_SOCK: this.getSocketPaths().proxy,
    };

    // Check if already running
    try {
      const check = await os.proc.runAsUser(username, `nc -z 127.0.0.1 ${port}`, {
        timeoutMs: 2000,
      });
      if (check.exitCode === 0) {
        logger.debug(`[BridgeBox] Already attached to ${username} on port ${port}`);
        return;
      }
    } catch {}

    logger.info(`[BridgeBox] Attaching to ${username} on port ${port}...`);

    await os.proc.runAsUser(
      username,
      `mkdir -p ${sandboxLogDir} && BRIDGE_SOCK=${env.BRIDGE_SOCK} PROXY_SOCK=${env.PROXY_SOCK} nohup python3 -u /Users/${username}/.sbx/bin/api_bridge.py ${port} >${sandboxLogDir}/api_bridge.log 2>&1 &`,
    );

    // Wait for the port to be open (up to 6 seconds)
    for (let i = 0; i < 30; i++) {
      try {
        const check = await os.proc.runAsUser(username, `nc -z 127.0.0.1 ${port}`, {
          timeoutMs: 1000,
        });
        if (check.exitCode === 0) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `Timed out waiting for API bridge to start in sandbox ${username} on port ${port}`,
    );
  }
}

let instance: BridgeBox | null = null;

export function getBridge(hostUser: string, sandboxUser?: string): BridgeBox {
  if (!instance) {
    instance = new BridgeBox(hostUser, sandboxUser);
  }
  return instance;
}
