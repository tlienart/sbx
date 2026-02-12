import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockOS, setOS } from '../common/os/index.ts';
import { IdentityBox } from '../identity/index.ts';
import { PersistenceBox } from '../persistence/index.ts';
import type { Sandbox, SandboxManager } from '../sandbox/types.ts';
import { AgentManager } from './AgentManager.ts';

describe('AgentManager', () => {
  let mockOs: ReturnType<typeof createMockOS>;
  let persistence: PersistenceBox;
  let identity: IdentityBox;
  let sandboxManager: SandboxManager;
  let agentManager: AgentManager;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
    persistence = new PersistenceBox(':memory:');
    identity = new IdentityBox();

    sandboxManager = {
      getSandbox: mock(() =>
        Promise.resolve({
          id: 'sb-1',
          name: 'test',
          createdAt: new Date(),
          status: 'active',
        } as Sandbox),
      ),
      findSandbox: mock(() =>
        Promise.resolve({
          id: 'sb-1',
          name: 'test',
          createdAt: new Date(),
          status: 'active',
        } as Sandbox),
      ),
      createSandbox: mock(() => Promise.resolve({} as Sandbox)),
      listSandboxes: mock(() => Promise.resolve([])),
      removeSandbox: mock(() => Promise.resolve()),
      isSandboxAlive: mock(() => Promise.resolve(true)),
    };

    agentManager = new AgentManager(persistence.agents, identity.users, sandboxManager);

    // Create sandbox in DB to satisfy foreign key
    persistence.sandboxes.create({
      id: 'sb-1',
      name: 'test',
      status: 'active',
      created_at: new Date().toISOString(),
    });
  });

  test('should start an agent and record state', async () => {
    const state = await agentManager.startAgent('sb-1', 'plan');
    expect(state.mode).toBe('plan');
    expect(state.status).toBe('idle');

    const inDb = agentManager.getAgentState('sb-1');
    expect(inDb).toBeDefined();
    expect(inDb?.mode).toBe('plan');
  });

  test('should update agent state', async () => {
    await agentManager.startAgent('sb-1');
    agentManager.updateAgentState('sb-1', { status: 'thinking', opencodeSessionId: 'session-123' });

    const updated = agentManager.getAgentState('sb-1');
    expect(updated?.status).toBe('thinking');
    expect(updated?.opencodeSessionId).toBe('session-123');
  });

  test('should interrupt agent (mocked)', async () => {
    mockOs.env.set('SKIP_PROVISION', '1');
    await agentManager.startAgent('sb-1');
    agentManager.updateAgentState('sb-1', { status: 'writing' });

    await agentManager.interruptAgent('sb-1');

    const state = agentManager.getAgentState('sb-1');
    expect(state?.status).toBe('idle');
  });

  test('should interrupt agent (real-ish su/pkill call)', async () => {
    mockOs.env.set('SKIP_PROVISION', '');
    await agentManager.startAgent('sb-1');
    agentManager.updateAgentState('sb-1', { status: 'writing' });

    let commandRun = '';
    mockOs.proc.setHandler('su', (args: string[]) => {
      commandRun = args.join(' ');
      return { stdout: '', stderr: '', exitCode: 0, command: '' };
    });

    await agentManager.interruptAgent('sb-1');

    expect(commandRun).toContain('pkill -u $(whoami) -f opencode');
    expect(agentManager.getAgentState('sb-1')?.status).toBe('idle');
  });
});
