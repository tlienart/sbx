import { describe, expect, spyOn, test } from 'bun:test';
import * as exec from './exec.ts';
import { getHostUser, getSessionUsername } from './user.ts';

describe('User logic', () => {
  test('getSessionUsername should follow the pattern', async () => {
    // We can't easily mock whoami without mocking the run function
    // But we know it should start with sbx_ and contain the host user and instance name
    const username = await getSessionUsername('test');
    const hostUser = await getHostUser();
    expect(username).toBe(`sbx_${hostUser}_test`);
  });
});
