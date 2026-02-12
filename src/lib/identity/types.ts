export interface UserInfo {
  username: string;
  instanceName: string;
}

export interface UserReadyState {
  identity: boolean;
  shell: boolean;
  network: boolean;
}
