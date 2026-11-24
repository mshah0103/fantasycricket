import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SportmonksConfig {
  token: string;
  dataDir: string;
}

/** Walks up from this module to the directory containing pnpm-workspace.yaml. */
export function findRepoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate repo root (pnpm-workspace.yaml)');
    dir = parent;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SportmonksConfig {
  const token = env.SPORTMONKS_API_TOKEN;
  if (!token) {
    throw new Error('SPORTMONKS_API_TOKEN is not set; export it before using the Sportmonks client');
  }
  return { token, dataDir: resolve(findRepoRoot(), env.FC_DATA_DIR || 'data') };
}
