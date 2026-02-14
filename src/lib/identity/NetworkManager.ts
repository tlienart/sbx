import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';

export class NetworkManager {
  private os = getOS();
  private anchorBase = 'com.apple/sbx';

  async init(): Promise<void> {
    try {
      // Create pflog0 interface if it doesn't exist
      // In CI, ifconfig might fail if not root, but 'reject: false' handles it.
      await this.os.proc.sudo('ifconfig', ['pflog0', 'create'], { reject: false });

      // Check if PF is already enabled to avoid redundant sudo calls or side effects
      const status = await this.checkStatus();
      if (!status.enabled) {
        logger.info('Enabling macOS Packet Filter (PF)...');
        await this.os.proc.sudo('pfctl', ['-e'], { reject: false });
      }
    } catch (err) {
      logger.warn(`Failed to initialize network manager: ${err}`);
    }
  }

  async enableRestrictedNetwork(uid: string, allowedPorts: number[] = []): Promise<void> {
    logger.info(`Enabling restricted network for UID ${uid}...`);

    // PF Rules:
    // 1. Allow loopback traffic to specific ports (API and Proxy)
    // 2. Block all other outbound traffic (TCP/UDP) for this UID, logging blocks.
    // Use 'quick' to stop processing once a match is found.
    const rules = [
      ...allowedPorts.map(
        (port) => `pass out quick proto tcp from any to 127.0.0.1 port ${port} user ${uid}`,
      ),
      `block out log (all, user) quick proto {tcp, udp} all user ${uid}`,
    ].join('\n');

    const anchorName = `${this.anchorBase}/uid_${uid}`;

    try {
      // 1. Ensure PF is enabled
      await this.os.proc.sudo('pfctl', ['-e'], { reject: false });

      // 2. Load rules into the anchor
      const tmpFile = `/tmp/sbx_pf_${uid}.conf`;
      await Bun.write(tmpFile, rules);

      // Load the anchor.
      await this.os.proc.sudo('pfctl', ['-a', anchorName, '-f', tmpFile]);
      await this.os.proc.run('rm', [tmpFile]);

      logger.success(`Restricted network rule loaded for UID ${uid} in anchor ${anchorName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to enable restricted network for UID ${uid}: ${msg}`);
      throw err;
    }
  }

  async disableRestrictedNetwork(uid: string): Promise<void> {
    logger.info(`Disabling restricted network for UID ${uid}...`);
    const anchorName = `${this.anchorBase}/uid_${uid}`;

    try {
      // Flush the anchor
      await this.os.proc.sudo('pfctl', ['-a', anchorName, '-F', 'all'], { reject: false });
      logger.info(`Restricted network anchor ${anchorName} flushed.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to disable restricted network for UID ${uid}: ${msg}`);
    }
  }

  async checkStatus(): Promise<{ enabled: boolean; anchorReferenced: boolean }> {
    let enabled = false;
    let anchorReferenced = false;

    try {
      const { stdout: info } = await this.os.proc.sudo('pfctl', ['-s', 'info']);
      enabled = info.includes('Status: Enabled');

      const { stdout: conf } = await this.os.proc.run('cat', ['/etc/pf.conf']);
      anchorReferenced =
        conf.includes(`anchor "${this.anchorBase}/*"`) || conf.includes('anchor "com.apple/*"');
    } catch (err) {
      logger.warn(`Failed to check PF status: ${err}`);
    }

    return { enabled, anchorReferenced };
  }
}
