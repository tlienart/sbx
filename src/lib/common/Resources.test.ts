import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Resources } from './Resources.ts';
import { createMockOS, setOS } from './os/index.ts';

describe('Resources', () => {
  let mockOs: ReturnType<typeof createMockOS>;

  beforeEach(() => {
    mockOs = createMockOS();
    setOS(mockOs);
  });

  test('should render templates', () => {
    const template = 'Hello ${NAME}!';
    const rendered = Resources.render(template, { NAME: 'World' });
    expect(rendered).toBe('Hello World!');
  });

  test('should return empty string for missing variables', () => {
    const template = 'Hello ${NAME}!';
    const rendered = Resources.render(template, {});
    expect(rendered).toBe('Hello !');
  });

  test('should load shims from filesystem', () => {
    const shimPath = join(process.cwd(), 'src/resources/shims/test.py');
    mockOs.fs.write(shimPath, 'print("hello")');

    const content = Resources.getShim('test.py');
    expect(content).toBe('print("hello")');
  });
});
