import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { getOS } from '../common/os/index.ts';
import { logger } from '../logger.ts';
import type { SecretManager } from './SecretManager.ts';

export class ApiProxy {
  private server: http.Server | null = null;
  private socketPath: string;
  private bridgeDir: string;
  private sandboxUser: string | null = null;
  private os = getOS();

  constructor(
    hostUser: string,
    private secretManager: SecretManager,
    sandboxUser?: string,
  ) {
    this.bridgeDir = `/tmp/.sbx_${hostUser}`;
    this.sandboxUser = sandboxUser || null;

    if (!this.os.fs.exists(this.bridgeDir)) {
      this.os.fs.mkdir(this.bridgeDir, { recursive: true });
      // chmodSync is not in IFileSystem yet, I should add it or use proc.run
      this.os.proc.run('chmod', ['711', this.bridgeDir]);
    }
    this.socketPath = join(this.bridgeDir, 'proxy.sock');
  }

  async start() {
    if (this.os.fs.exists(this.socketPath)) this.os.fs.remove(this.socketPath);

    this.server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        logger.debug(`[ApiProxy] Incoming request: ${req.method} ${url.pathname}`);

        let targetHost: string | undefined;
        let targetPath: string | undefined;
        let authHeader: string | undefined;
        let authValue: string | undefined;
        let isGoogle = false;
        let providerName = '';

        if (url.pathname.startsWith('/google')) {
          providerName = 'google';
          let path = url.pathname.replace('/google', '');
          if (!path.startsWith('/v1beta')) path = `/v1beta${path}`;
          targetHost = 'generativelanguage.googleapis.com';
          targetPath = path;
          authHeader = 'x-goog-api-key';
          authValue = this.secretManager.getApiKey('google');
          isGoogle = true;
        } else if (url.pathname.startsWith('/openai')) {
          providerName = 'openai';
          targetHost = 'api.openai.com';
          targetPath = url.pathname.replace('/openai', '');
          authHeader = 'Authorization';
          authValue = `Bearer ${this.secretManager.getApiKey('openai')}`;
        } else if (url.pathname.startsWith('/anthropic')) {
          providerName = 'anthropic';
          targetHost = 'api.anthropic.com';
          targetPath = url.pathname.replace('/anthropic', '');
          authHeader = 'x-api-key';
          authValue = this.secretManager.getApiKey('anthropic');
        }

        if (targetHost && authValue && authHeader) {
          const finalPath = `${targetPath}${url.search}`;
          const finalUrl = new URL(`https://${targetHost}${finalPath}`);
          if (isGoogle) finalUrl.searchParams.set('key', authValue);

          const proxyReq = https.request(
            {
              hostname: targetHost,
              port: 443,
              path: `${finalUrl.pathname}${finalUrl.search}`,
              method: req.method,
              headers: {
                ...req.headers,
                host: targetHost,
                [authHeader.toLowerCase()]: authValue,
              },
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', (e) => {
            logger.error(`[ApiProxy] Upstream error: ${e.message}`);
            res.writeHead(502);
            res.end('Proxy Error');
          });

          req.pipe(proxyReq);
        } else if (providerName) {
          res.writeHead(401);
          res.end(`Missing host secret: SBX_${providerName.toUpperCase()}_API_KEY`);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        logger.error(`[ApiProxy] Internal error: ${error}`);
        res.writeHead(500);
        res.end('Internal Error');
      }
    });

    this.server.listen(this.socketPath, () => {
      logger.debug(`[ApiProxy] Listening on ${this.socketPath}`);
      this.setPermissions();
    });

    // Wait for socket
    for (let i = 0; i < 20; i++) {
      if (this.os.fs.exists(this.socketPath)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for API proxy socket');
  }

  private setPermissions() {
    if (this.sandboxUser) {
      try {
        this.os.proc.sudo('chmod', [
          '+a',
          `user:${this.sandboxUser} allow read,write`,
          this.socketPath,
        ]);
      } catch (err) {
        logger.debug(`[ApiProxy] Failed to set ACL on socket: ${err}`);
        this.os.proc.run('chmod', ['666', this.socketPath]);
      }
    } else {
      this.os.proc.run('chmod', ['666', this.socketPath]);
    }
  }

  stop() {
    this.server?.close();
    if (this.os.fs.exists(this.socketPath)) this.os.fs.remove(this.socketPath);
  }

  getSocketPath() {
    return this.socketPath;
  }
}
