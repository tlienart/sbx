import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import http from 'node:http';
import { TrafficProxy } from './TrafficProxy.ts';

describe('TrafficProxy', () => {
  let proxy: TrafficProxy;
  const proxyPort = 16000;

  beforeEach(async () => {
    proxy = new TrafficProxy({
      port: proxyPort,
      whitelist: ['example.com', '*.google.com'],
    });
    await proxy.start();
  });

  afterEach(() => {
    proxy.stop();
  });

  test('should allow whitelisted domain', async () => {
    // Create a mock target server
    const targetPort = 16001;
    const targetServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => targetServer.listen(targetPort, resolve));

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        method: 'GET',
        headers: {
          Host: 'example.com',
        },
        // In real use, fetch would go to proxyPort but we need to trick it to think it's talking to example.com
        // But since we are testing the proxy itself, we can just send the request to proxyPort
      });

      // Wait, standard fetch doesn't support proxies directly like this easily in tests without extra logic.
      // We'll use http.request directly to talk to the proxy.

      const p = new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxyPort,
            method: 'GET',
            path: `http://127.0.0.1:${targetPort}/`,
            headers: {
              Host: 'example.com',
            },
          },
          (res) => {
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end();
      });

      const statusCode = await p;
      expect(statusCode).toBe(200);
    } finally {
      targetServer.close();
    }
  });

  test('should block non-whitelisted domain', async () => {
    const p = new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: 'http://malicious.com/',
          headers: {
            Host: 'malicious.com',
          },
        },
        (res) => {
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });

    const statusCode = await p;
    expect(statusCode).toBe(403);
  });

  test('should allow subdomains if whitelisted with wildcard', async () => {
    const targetPort = 16002;
    const targetServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => targetServer.listen(targetPort, resolve));

    try {
      const p = new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxyPort,
            method: 'GET',
            path: `http://127.0.0.1:${targetPort}/`,
            headers: {
              Host: 'sub.google.com',
            },
          },
          (res) => {
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end();
      });

      const statusCode = await p;
      expect(statusCode).toBe(200);
    } finally {
      targetServer.close();
    }
  });
});
