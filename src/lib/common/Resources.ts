import { join } from 'node:path';
import { getOS } from './os/index.ts';

const shimsDir = join(process.cwd(), 'src/resources/shims');

export const Resources = {
  getShim(name: string): string {
    const os = getOS();
    const path = join(shimsDir, name);
    if (!os.fs.exists(path)) {
      throw new Error(`Shim not found: ${name} at ${path}`);
    }
    return os.fs.read(path);
  },

  render(template: string, variables: Record<string, string>): string {
    return template.replace(/\${(\w+)}/g, (_, key) => {
      return variables[key] || '';
    });
  },
};
