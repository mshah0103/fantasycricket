import { resolve } from 'node:path';

/** Value following `--name` in argv, or undefined. */
export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function requireYear(argv: string[], name: string): number {
  const v = flag(argv, name);
  if (!v || !/^\d{4}$/.test(v)) throw new Error(`--${name} <year> is required (4-digit year)`);
  return Number(v);
}

/**
 * A path the user typed, resolved against the directory the command was started from. Run through pnpm, the
 * process cwd is the package directory; pnpm passes the starting directory as INIT_CWD (the repo root for the
 * root proxy scripts), so `--write docs/x.md` means the same file from the root as `../../docs/x.md` here.
 */
export function userPath(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.INIT_CWD || process.cwd(), p);
}
