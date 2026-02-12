import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { ApiProxy } from './ApiProxy.ts';
import { SecretManager } from './SecretManager.ts';

describe('ApiProxy', () => {
  let mockOs: any;
  let secretManager: SecretManager;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    secretManager = new SecretManager();
  });

  test('should initialize correctly', () => {
    const proxy = new ApiProxy('host-user', secretManager);
    expect(proxy).toBeDefined();
    expect(proxy.getSocketPath()).toContain('proxy.sock');
  });
});
