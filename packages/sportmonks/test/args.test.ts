import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flag, userPath } from '../src/cli/args.js';

describe('cli args', () => {
  it('flag reads the value after --name', () => {
    expect(flag(['--write', 'docs/x.md'], 'write')).toBe('docs/x.md');
    expect(flag([], 'write')).toBeUndefined();
  });

  it('userPath resolves a relative path against INIT_CWD (where the command was typed), else the cwd', () => {
    expect(userPath('docs/x.md', { INIT_CWD: '/repo' })).toBe('/repo/docs/x.md');
    expect(userPath('/abs/x.md', { INIT_CWD: '/repo' })).toBe('/abs/x.md');
    expect(userPath('docs/x.md', {})).toBe(resolve(process.cwd(), 'docs/x.md'));
    expect(userPath('docs/x.md', { INIT_CWD: '' })).toBe(resolve(process.cwd(), 'docs/x.md'));
  });
});
