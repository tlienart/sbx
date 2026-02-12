import { join } from 'node:path';
import { getOS } from './os/index.ts';

export class Resources {
  private static shimsDir = join(process.cwd(), 'src/resources/shims');

  static getShim(name: string): string {
    const os = getOS();
    const path = join(Resources.shimsDir, name);
    if (!os.fs.exists(path)) {
      throw new Error(`Shim not found: ${name} at ${path}`);
    }
    return os.fs.read(path);
  }

  static render(template: string, variables: Record<string, string>): string {
    return template.replace(/\${(\w+)}/g, (_, key) => {
      return variables[key] || '';
    });
  }
}
