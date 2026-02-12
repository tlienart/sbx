import { beforeEach, describe, expect, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { SecretManager } from './SecretManager.ts';

describe('SecretManager', () => {
  let mockOs: ReturnType<typeof createMockOS>;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
  });

  test('should harvest secrets from environment', () => {
    mockOs.env.set('SBX_GITHUB_TOKEN', 'gh-token');
    mockOs.env.set('SBX_GOOGLE_API_KEY', 'google-key');

    const manager = new SecretManager();
    const secrets = manager.getSecrets();

    expect(secrets.github).toBe('gh-token');
    expect(secrets.google).toBe('google-key');
    expect(secrets.openai).toBe('');
  });

  test('should return individual secrets', () => {
    mockOs.env.set('SBX_OPENAI_API_KEY', 'openai-key');
    const manager = new SecretManager();

    expect(manager.getGithubToken()).toBe('');
    expect(manager.getApiKey('openai')).toBe('openai-key');
    expect(manager.hasSecret('openai')).toBe(true);
    expect(manager.hasSecret('anthropic')).toBe(false);
  });
});
