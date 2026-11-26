import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createFileArchive } from '../archive.js';
import { findRepoRoot } from '../config.js';
import { buildGateReport, mergeGateReport } from '../gates.js';
import { flag, userPath } from './args.js';

// Usage: sm:gates [--write <path>]. Reads local files only: deliberately does not use loadConfig(), so no
// Sportmonks token is needed. Without --write the report goes to stdout. With --write, text after the
// "END GENERATED" marker in an existing file is kept. A relative path is relative to where the command was typed
// (INIT_CWD): from the repo root, `pnpm sm:gates --write docs/sportmonks-verification.md`.
const argv = process.argv.slice(2);
const dataDir = resolve(findRepoRoot(), process.env.FC_DATA_DIR || 'data');
const report = await buildGateReport({
  historyDir: join(dataDir, 'history'),
  recordingsDir: join(dataDir, 'recordings'),
  archive: createFileArchive(dataDir),
});

const target = flag(argv, 'write');
if (argv.includes('--write') && !target) throw new Error('--write <path> needs a path');
if (target) {
  const path = userPath(target);
  let existing: string | null = null;
  try {
    existing = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await writeFile(path, mergeGateReport(existing, report));
  console.log(`wrote ${path}`);
} else {
  process.stdout.write(report);
}
