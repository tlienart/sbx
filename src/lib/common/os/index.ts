import type { IOS } from './interface.ts';
import { RealOS } from './real.ts';

let currentOS: IOS = RealOS;

export function getOS(): IOS {
  return currentOS;
}

export function setOS(os: IOS): void {
  currentOS = os;
}

export { createMockOS } from './mock.ts';
export * from './interface.ts';
