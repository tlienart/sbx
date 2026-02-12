import type { UserInfo } from './types.ts';

export interface IIdentityManager {
  createUser(instanceName: string): Promise<string>;
  deleteUser(instanceName: string): Promise<void>;
  userExists(username: string): Promise<boolean>;
  isUserActive(username: string): Promise<boolean>;
  getNumericUid(username: string): Promise<string>;
  listUsers(): Promise<UserInfo[]>;
  getHostUser(): Promise<string>;
  getSessionUsername(instanceName: string): Promise<string>;
}
