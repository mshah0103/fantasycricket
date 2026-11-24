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
