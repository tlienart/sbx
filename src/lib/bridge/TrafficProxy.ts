import http from 'node:http';
import net from 'node:net';
import { logger } from '../logger.ts';

export interface TrafficProxyOptions {
  port: number;
  whitelist: string[];
  onBlocked?: (domain: string, method: string, url: string) => Promise<void>;
}

export class TrafficProxy {
  private server: http.Server;
  private port: number;
  private whitelist: Set<string>;
  private onBlocked?: (domain: string, method: string, url: string) => Promise<void>;

  constructor(options: TrafficProxyOptions) {
    this.port = options.port;
    this.whitelist = new Set(options.whitelist);
    this.onBlocked = options.onBlocked;

    this.server = http.createServer();
    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle HTTP requests
    this.server.on('request', (req, res) => {
      const url = req.url || '';
      let host = req.headers.host || '';

      // If absolute URL
      if (url.startsWith('http')) {
        try {
          const parsed = new URL(url);
          host = parsed.host;
        } catch {}
      }

      const domain = host.split(':')[0] || '';

      if (this.isWhitelisted(domain)) {
        this.proxyHttpRequest(req, res);
      } else {
        this.handleBlockedRequest(domain, req.method || 'GET', url, res);
      }
    });

    // Handle HTTPS (CONNECT)
    this.server.on('connect', (req, socket, head) => {
      const host = req.url || '';
      const domain = host.split(':')[0] || '';
      const clientSocket = socket as net.Socket;

      if (this.isWhitelisted(domain)) {
        this.proxyHttpsRequest(req, clientSocket, head);
      } else {
        logger.warn(`[TrafficProxy] Blocked CONNECT to ${domain}`);
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.end();
        this.onBlocked?.(domain, 'CONNECT', host);
      }
    });
  }

  private isWhitelisted(domain: string): boolean {
    if (domain === '127.0.0.1' || domain === 'localhost') return true;
    if (this.whitelist.has(domain)) return true;

    // Support subdomains
    for (const entry of this.whitelist) {
      if (entry.startsWith('*.') && domain.endsWith(entry.slice(2))) {
        return true;
      }
      if (domain.endsWith(`.${entry}`)) {
        return true;
      }
    }
    return false;
  }

  private proxyHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    const proxyReq = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      logger.error(`[TrafficProxy] HTTP Proxy Error: ${err.message}`);
      res.writeHead(502);
      res.end('Proxy Error');
    });

    req.pipe(proxyReq);
  }

  private proxyHttpsRequest(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const hostParts = (req.url || '').split(':');
    const hostname = hostParts[0];
    const port = Number.parseInt(hostParts[1] || '443', 10);

    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      logger.error(`[TrafficProxy] HTTPS Proxy Error: ${err.message}`);
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });
  }

  private async handleBlockedRequest(
    domain: string,
    method: string,
    url: string,
    res: http.ServerResponse,
  ) {
    logger.warn(`[TrafficProxy] Blocked ${method} to ${domain}`);

    // Notify about blocked request
    this.onBlocked?.(domain, method, url);

    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(
      `SBX Network Restriction: Domain '${domain}' is not whitelisted. \n\nYour request has been blocked. If you need access, please ask the user to whitelist this domain.`,
    );
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        logger.info(`[TrafficProxy] Listening on 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    this.server.close();
  }

  updateWhitelist(whitelist: string[]) {
    this.whitelist = new Set(whitelist);
  }

  getPort() {
    return this.port;
  }
}
