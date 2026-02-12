/**
 * Deterministic port generation for sandbox instances.
 */
export function getSandboxPort(instanceName: string): number {
  let hash = 0;
  for (let i = 0; i < instanceName.length; i++) {
    hash = (hash << 5) - hash + instanceName.charCodeAt(i);
    hash |= 0;
  }
  return 10000 + (Math.abs(hash) % 5000);
}
