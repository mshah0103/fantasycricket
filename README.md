# fantasycricket

Private IPL cricket fantasy league. TypeScript pnpm monorepo.

- `packages/scoring` (`@fc/scoring`): scoring contract and pure scoring functions.
- `packages/sportmonks` (`@fc/sportmonks`): Sportmonks Cricket client, raw archive, normalizer, history build, match-day recorder and the verification report.
- `packages/cricsheet` (`@fc/cricsheet`): one-time Cricsheet import for the IPL seasons Sportmonks lacks (2008–2012).

```
pnpm install
pnpm test
pnpm typecheck
```

## Configuration

Put a `.env` file at the repo root (it is git-ignored; never commit it):

```
SPORTMONKS_API_TOKEN=...
FC_DATA_DIR=data
```

- `SPORTMONKS_API_TOKEN`: needed by the commands that call Sportmonks (`sm:list-fixtures`, `sm:pull-history`, `sm:pull-squads`, `sm:record`). The others read local files only.
- `FC_DATA_DIR` (optional, default `data`, relative to the repo root): the raw archive, recordings, Cricsheet files and history output. It is git-ignored.

Every `sm:*` and `cs:*` command runs from the repo root, e.g. `pnpm sm:gates`. A relative `--write` or `--dir` path is relative to the repo root.

## Match days

1. Find the fixture: `pnpm sm:list-fixtures --league "Big Bash League" --season 2026`.
2. Record it: `pnpm sm:record --fixture <id>`, started more than 60 minutes before the start. It polls until 2 hours after the match finishes (and gives up 12 hours after the start if it never does).
3. Afterwards, update the report: `pnpm sm:gates --write docs/sportmonks-verification.md`. The hand-written part below `<!-- END GENERATED -->` is kept.
4. Re-running `pnpm sm:record --fixture <id>` after its window does one more fetch and stops; gate 7 uses it to look for post-match corrections.

After the IPL auction: `pnpm sm:pull-squads --year 2027` (team ids come from the most recent season with fixtures until 2027 has its own; `--teams <id,id,...>` overrides), then `pnpm sm:gates --write docs/sportmonks-verification.md` for gate 8.

Spec and plans live under `docs/superpowers/`.
