# Sportmonks test fixtures (real IPL 2025 responses)

Each file is the latest successful archived body of
`GET /fixtures/:id?include=batting,bowling,balls,lineup,runs,scoreboards`
(`{ "data": { ... } }`), pretty-printed by
`pnpm --filter @fc/sportmonks sm:export-fixture <fixtureId> <name>`.
The export reads only the local raw archive (`data/sportmonks/`), not the network.
All files were exported on 2026-11-26. Each fixture had two identical archived
versions (fetched 16:29Z and 16:35Z).
No token or query string is stored. The only URLs are `cdn.sportmonks.com` image paths.

Season 2025 is `season_id` 1689. Team ids: DC 3, PBKS 4, KKR 5, MI 6, RR 7, GT 1976, LSG 1979.
Field meanings are in [`../../FIELD_MAP.md`](../../FIELD_MAP.md).

| File | Fixture id | Match (UTC start) | Why it was chosen |
|---|---:|---|---|
| `ipl2025-m64-gt-lsg.json` | 65607 | 64th Match, GT v LSG, 2025-05-22 | Golden case: Mitchell Marsh (player 31) made 117 off 64 balls, with 10 fours and 8 sixes (spec §5.9). It also has two substitute catches by Ravi Bishnoi (`Catch Out (Sub)`, `catch_stump_player_id` 9459, `lineup.substitution: true`). In GT's innings, over 6 is split between two bowlers (Akash Maharaj Singh bowled 5.1, Avesh Khan bowled 5.2–5.6). |
| `ipl2025-m63-mi-dc.json` | 65608 | 63rd Match, MI v DC, 2025-05-21 | Golden case: Jasprit Bumrah (player 284) took 3/12 in 3.2 overs. From the balls: 20 legal balls, 12 dots, no wides, no no-balls. It also has a substitute catch by Raj Angad Bawa (35051). |
| `ipl2025-m69-pbks-mi.json` | 65603 | 69th Match, PBKS v MI, 2025-05-26 | Golden case: Josh Inglis (player 623, wicketkeeper) made 73 off 42 balls, with 9 fours, 3 sixes and 1 catch. This file also shows that the bowling card's `wide` field counts wide **runs**, not deliveries: Vyshak (46736) has card `wide: 7` from three wide deliveries (1 + 5 + 1). |
| `ipl2025-m32-dc-rr-superover.json` | 65574 | 32nd Match, DC v RR, 2025-04-16 | The tie was decided by a Super Over. `super_over: true`. Regulation play is scoreboards `S1`/`S2` and the Super Over is `S3` (RR 11/2) and `S4` (DC 13/0). It has the handoff's Super Over deltas (KL Rahul, Stubbs, Hetmyer, Parag, Sandeep Sharma) and a four off a no-ball (Parag, `1 No Ball + Four`). There are two Super Over run-outs, each with two fielders, and Sanju Samson retired hurt. |
| `ipl2025-m44-kkr-pbks-noresult.json` | 65586 | 44th Match, KKR v PBKS, 2025-04-26 | Abandoned after play started: `status: "Aban."`, `draw_noresult: "no-result"`, `note: "No result"`. PBKS made 201/4 in 20 overs and KKR 7/0 in 1 over, then rain stopped play. The KKR innings has a bowling row with 0 overs for Arshdeep Singh (4880). |
| `ipl2025-fielding-sample.json` | 65571 | 29th Match, DC v MI, 2025-04-13 | Every run-out shape in one fixture, in the 19th over of the DC chase: a two-fielder run-out (Ashutosh Sharma: `catch_stump_player_id` Will Jacks 3806, `runout_by_id` Ryan Rickelton 662), a **substitute** two-fielder run-out (Kuldeep Yadav: `Run Out (Sub)`, `catch_stump_player_id` Raj Angad Bawa 35051, who is a `substitution: true` lineup player, `runout_by_id` Rickelton 662), and a single-fielder run-out with `runout_by_id: null` (Mohit Sharma: `catch_stump_player_id` Mitchell Santner 227). It also has a caught-and-bowled (KL Rahul c & b Karn Sharma 2999, an impact substitute), a stumping off a wide (`1 Wide + stump Out`, Vipraj Nigam st Rickelton) and an impact substitute who batted (Karun Nair 2912, 89 runs). |

## Why 65571 is the fielding sample

In 2025 there are 39 run-outs and 13 substitute dismissals (12 `Catch Out (Sub)` and 1 `Run Out (Sub)`).
65571 is the only 2025 fixture that has a run-out by a substitute. It is also the only one that has all three run-out shapes:

- `runout_by_id` set together with `catch_stump_player_id`
- `runout_by_id` null with only `catch_stump_player_id`
- a substitute

The run-out shape matters for gate 1 (see FIELD_MAP §5.2). Substitute **catches** are already covered by m64 (two) and m63 (one).
Every 2025 substitute fielder appears in the fixture's `lineup` with `lineup.substitution: true`. A "substitute not in the lineup" case therefore does not occur in real 2025 data. Task 7 builds it synthetically (m64 copy with fielder id `999999`).

## Not exported, but referenced

- **65610** (58th Match, RCB v KKR, 2025-05-17): a washout. `Aban.`, `draw_noresult: "no-result"`, note "Match abandoned without a ball bowled". It has no lineup, batting, bowling, balls, runs or scoreboards.
- **65597** (55th Match, SRH v DC, 2025-05-05): `Aban.` + `no-result` after one full innings (DC 133/7).
- **59270** (2024, 70th Match): a washout after the toss. It **has** a 32-player lineup but no balls.
- **65546** (4th Match, DC v LSG, 2025-03-24): a finished fixture with a gap in its ball-by-ball data (see FIELD_MAP §11).
