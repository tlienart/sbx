import { logger } from '../logger.ts';

export interface NetworkBlockEvent {
  uid: number;
  protocol: string;
  source: string;
  destination: string;
}

export class NetworkMonitor {
  private process: ReturnType<typeof Bun.spawn> | null = null;
  private listeners: ((event: NetworkBlockEvent) => void)[] = [];

  async start() {
    if (this.process) return;

    logger.info('Starting Network Monitor (tcpdump on pflog0)...');

    try {
      this.process = Bun.spawn(['sudo', 'tcpdump', '-ni', 'pflog0', '-e', '-t', '-l'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      this.process.unref();

      if (this.process.stdout instanceof ReadableStream) {
        this.readStream(this.process.stdout);
      }

      this.process.exited.then((code) => {
        if (code !== 0) {
          logger.warn(`Network Monitor exited with code ${code}`);
        }
        this.process = null;
      });
    } catch (err) {
      logger.error(`Failed to start Network Monitor: ${err}`);
    }
  }

  private async readStream(stdout: ReadableStream) {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.parseLine(line);
        }
      }
    }
  }

  private parseLine(line: string) {
    try {
      const uidMatch = line.match(/\[uid (\d+)\]/);
      if (!uidMatch) return;

      const uidStr = uidMatch[1];
      if (!uidStr) return;
      const uid = Number.parseInt(uidStr, 10);

      const parts = line.split(': ');
      if (parts.length < 3) return;

      const trafficPart = parts[2];
      const protoPart = parts[3];

      if (!trafficPart) return;

      const trafficMatch = trafficPart.match(/(\S+) > (\S+)/);
      if (!trafficMatch) return;

      const source = trafficMatch[1];
      const destination = trafficMatch[2];

      if (!source || !destination) return;

      const protocol = protoPart ? protoPart.split(',')[0] || 'UNKNOWN' : 'UNKNOWN';

      const event: NetworkBlockEvent = {
        uid,
        protocol,
        source,
        destination,
      };

      for (const listener of this.listeners) {
        listener(event);
      }
    } catch (err) {
      logger.debug(`Failed to parse PF log line: ${err}`);
    }
  }

  onBlock(callback: (event: NetworkBlockEvent) => void) {
    this.listeners.push(callback);
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
