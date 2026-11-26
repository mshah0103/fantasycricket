# Cricsheet test fixtures (real IPL 2025 matches)

Data from Cricsheet, https://cricsheet.org, ODC-By 1.0 (see [`LICENSE.txt`](LICENSE.txt), copied unchanged
from the Cricsheet download).

Both files are unmodified copies from Cricsheet's IPL archive (`https://cricsheet.org/downloads/ipl_json.zip`,
JSON format version 1.3.0, https://cricsheet.org/format/json/), downloaded for this project in November 2026 and
kept locally at `data/cricsheet/ipl_json/` (git-ignored). The file name is the ESPNcricinfo match id.
Tests read them with `JSON.parse` only.

They are the same two matches as two of the Sportmonks fixtures in
[`../../../sportmonks/test/fixtures/`](../../../sportmonks/test/fixtures/README.md), so the cross-source test can
score each player from both sources and compare.

| File | Match | Sportmonks twin | Why it was chosen |
|---|---|---|---|
| `1473502.json` | IPL 2025 match 64, GT v LSG, 2025-05-22 | `ipl2025-m64-gt-lsg.json` (65607) | Golden case: Mitchell Marsh (`MR Marsh`) 117 off 64 with 10 fours and 8 sixes (spec §5.9). Two substitute catches by Ravi Bishnoi (`substitute: true`, not in `info.players`), an over split between two bowlers after an injury (`replacements.role`), and two impact players. No run-outs, so the cross-source totals must match exactly. |
| `1473466.json` | IPL 2025 match 29, DC v MI, 2025-04-13 | `ipl2025-fielding-sample.json` (65571) | All three run-out shapes in the 19th over of the DC chase: two fielders (Ashutosh Sharma), two fielders with a substitute (Kuldeep Yadav, `RA Bawa` `substitute: true`) and one fielder (Mohit Sharma, `MJ Santner`). Also a caught-and-bowled (KL Rahul, `KV Sharma`), a stumping off a wide (`V Nigam`), an all-run four (`non_boundary`) and impact players. Run-out credit differs between the sources by design (Task 12 ruling: Cricsheet run-outs are never credited under the current rule), so Rickelton is the one expected difference. |
