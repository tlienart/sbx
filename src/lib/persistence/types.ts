export type SandboxStatus = 'active' | 'archived';

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  restricted_network: number;
  whitelist: string | null;
  created_at: string;
}

export interface Session {
  platform: string;
  external_id: string;
  sandbox_id: string;
  created_at: string;
  last_activity: string;
}

export type AgentStatus = 'idle' | 'thinking' | 'writing';

export interface AgentState {
  sandbox_id: string;
  mode: string;
  status: AgentStatus;
  opencode_session_id?: string | null;
  last_activity: string;
}
