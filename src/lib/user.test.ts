import { describe, expect, test } from 'bun:test';
import { getHostUser, getSandboxPort, getSessionUsername } from './user.ts';

describe('User logic', () => {
  test('getSessionUsername should follow the pattern', async () => {
    const username = await getSessionUsername('test');
    const hostUser = await getHostUser();
    expect(username).toBe(`sbx_${hostUser}_test`);
  });

  test('getSandboxPort should be deterministic', () => {
    const port1 = getSandboxPort('test');
    const port2 = getSandboxPort('test');
    const port3 = getSandboxPort('other');
    expect(port1).toBe(port2);
    expect(port1).not.toBe(port3);
    expect(port1).toBeGreaterThanOrEqual(10000);
    expect(port1).toBeLessThan(15000);
  });
});
