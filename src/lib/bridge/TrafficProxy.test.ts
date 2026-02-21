import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type net from 'node:net';
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
    const server = http.createServer((_, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const serverPort = (server.address() as net.AddressInfo).port;

    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: `http://127.0.0.1:${serverPort}`,
      headers: {
        Host: 'example.com',
      },
    });

    const response = await new Promise<http.IncomingMessage>((resolve) => {
      req.on('response', resolve);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    server.close();
  });

  test('should block non-whitelisted domain', async () => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: 'http://malicious.com',
      headers: {
        Host: 'malicious.com',
      },
    });

    const response = await new Promise<http.IncomingMessage>((resolve) => {
      req.on('response', resolve);
      req.end();
    });

    expect(response.statusCode).toBe(403);
    const body = await new Promise<string>((resolve) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => resolve(data));
    });
    expect(body).toContain('not whitelisted');
  });

  test('should allow subdomains if whitelisted with wildcard', async () => {
    const server = http.createServer((_, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const serverPort = (server.address() as net.AddressInfo).port;

    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: `http://127.0.0.1:${serverPort}`,
      headers: {
        Host: 'sub.google.com',
      },
    });

    const response = await new Promise<http.IncomingMessage>((resolve) => {
      req.on('response', resolve);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    server.close();
  });
});
