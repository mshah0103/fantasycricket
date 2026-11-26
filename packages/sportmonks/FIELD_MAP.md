# Sportmonks field map (IPL, Cricket API v2.0)

The normalizer (plan Tasks 7–8) is built from this file. Every path below is inside the body of
`GET /fixtures/:id?include=batting,bowling,balls,lineup,runs,scoreboards`, which has the shape `{ "data": { … } }`.

**Evidence base.** The raw archive `data/sportmonks/` uses the latest 2xx body per endpoint, as of 2026-11-26.

- It holds 926 IPL fixtures, covering seasons 2013–2026 in full. Sportmonks has no IPL 2008–2012.
- It also holds the `/scores` catalog, which has 103 entries.
- "2025" means `season_id` 1689, which has 74 fixtures. All 2025 counts below cover the whole season, not only the exported files.
- Exported test fixtures live in `test/fixtures/` (see its README). This file refers to them by match number:

| Short name | Fixture id | File |
|---|---:|---|
| m64 | 65607 | `ipl2025-m64-gt-lsg.json` |
| m63 | 65608 | `ipl2025-m63-mi-dc.json` |
| m69 | 65603 | `ipl2025-m69-pbks-mi.json` |
| m32 | 65574 | `ipl2025-m32-dc-rr-superover.json` |
| m44 | 65586 | `ipl2025-m44-kkr-pbks-noresult.json` |
| m29 | 65571 | `ipl2025-fielding-sample.json` |

**Endpoint check (Task 6 step 4).** The live API accepted every path and include in `src/endpoints.ts`, so nothing was changed.

**Types.** Every id in the body is a JSON **number**: fixture, player, team and score ids. `PlayerMatchStats` uses strings, so convert with `String(id)`. `scoreboard` is a string code (`"S1"`, `"S2"`, …).

---

## 0. Checklist (plan Task 6 step 7)

| # | Item | Value / path | Seen in |
|---|---|---|---|
| 1 | Batting: runs, balls, fours, sixes | `data.batting[].score`, `.ball`, `.four_x`, `.six_x` | m64 (Marsh 117/64/10/8) |
| 2 | Dismissal on a batting record | `data.batting[].score_id` → `/scores` catalog `name`. `wicket_id` is always equal to `score_id`. Names and their `DismissalKind`: §4 | m64 (Marsh `54` `Catch Out`), m69 (Inglis `83` `LBW OUT`), all 2025 |
| 3 | Catch / stumping fielder | `data.batting[].catch_stump_player_id` | m69 (Inglis catch), m64 |
| 4 | Run-out fielder | Spec: `data.batting[].runout_by_id` (the `runoutby` relation). **This is null for single-fielder run-outs.** That fielder is in `catch_stump_player_id`. Gate 1 fails as written (§5.2). | m29 |
| 5 | Substitute catches / run-outs | Score names carry `(Sub)` (`Catch Out (Sub)`, `Run Out (Sub)`, `Stump Out (Sub)`). The substitute's player id **is given** in `catch_stump_player_id`, and he is in `data.lineup[]` with `lineup.substitution: true`. | m64, m63, m29 |
| 6 | Scoreboard codes | Regulation is `"S1"`, `"S2"`. Super Over is `"S3"`, `"S4"`. These apply to batting, bowling, balls and scoreboards. `runs[].inning` 1–4 maps to `S1`–`S4`. | m32 |
| 7 | Ball: batter runs, wides, no-balls, byes, leg-byes, wickets | `data.balls[].score{runs,four,six,bye,leg_bye,noball,noball_runs,is_wicket,ball,out,name}`. Rules: §6 | m32, m69 |
| 8 | Bowling-card fields | `data.bowling[].overs`, `.medians`, `.runs`, `.wickets`, `.wide` (**wide runs**), `.noball` (§7) | m69, m63 |
| 9 | Impact-substitute marker | `data.lineup[].lineup.substitution`. It marks the **5 named substitutes** per team, not "the one who came in". §8 | m29 (Karun Nair 2912 batted as Impact Player; Karn Sharma 2999 and Raj Angad Bawa 35051 are also `true`), m64 (Ravi Bishnoi 9459 `true`) |
| 10 | Fixture status values | `data.status` is `"Finished"` or `"Aban."`. Use it with `data.draw_noresult` (`null` / `"no-result"`), `data.note`, and whether there are balls (§1) | m44, m32, m64 |
| 11 | Player position | `data.lineup[].position.{id,name}`. 2025 values: `Batsman`, `Bowler`, `Wicketkeeper`, `Allrounder`, `Middle Order Batter`, `Bowling Allrounder`, `Batting Allrounder` (§9) | m64 (Marsh `{id:4,name:"Allrounder"}`; its lineup has ids 1, 2, 3, 4, 8, 11), m69 (Inglis `{id:3,name:"Wicketkeeper"}`) |

Every item is present in the source. No item needed a §12.3 "not present" fallback. Gates 1 and 3 are only partly met (§5.2, §2.2), and their fallbacks are named there.

---

## 1. Fixture metadata and status

| Field | Path | Observed |
|---|---|---|
| Fixture id | `data.id` | `65607` |
| League | `data.league_id` | `1` (Indian Premier League) |
| Season | `data.season_id` | `1689` (= 2025) |
| Round | `data.round` | `"64th Match"`, `"Qualifier 2"`, `"Final"` (string) |
| Start | `data.starting_at` | `"2025-05-22T14:00:00.000000Z"` (UTC, with microseconds) |
| Teams | `data.localteam_id`, `data.visitorteam_id` | m64: 1976 (GT), 1979 (LSG) |
| Status | `data.status` | `"Finished"`, `"Aban."` |
| Result text | `data.note` | `"Match tied (Delhi Capitals won the one-over eliminator)"`, `"No result"`, `"Match abandoned without a ball bowled"` |
| No-result marker | `data.draw_noresult` | `null` or `"no-result"` |
| Super Over flag | `data.super_over` | `true` on m32, `false` otherwise |
| Winner | `data.winner_team_id` | `null` for no-results |
| `live` | `data.live` | `true` or `false`, including on finished fixtures (m32 is `true`). **It does not mean "in progress".** |
| Toss / overs | `data.toss_won_team_id`, `data.total_overs_played` | both `null` on a washout (65610) |

**Status values across all 926 archived fixtures:**

| `status` | `draw_noresult` | `super_over` | Count | Meaning | Examples |
|---|---|---|---:|---|---|
| `Finished` | `null` | `false` | 899 | finished with a result | m64, m63, m69, m29 |
| `Finished` | `null` | `true` | 14 | tie decided by Super Over | m32 |
| `Finished` | `"no-result"` | `false` | 2 | partial-play no-result (2015 only) | 2069, 2147 |
| `Aban.` | `"no-result"` | `false` | 10 | 5 partial-play no-results (balls exist) and 5 washouts (no balls) | m44, 65597 (partial); 65610 (washout) |
| `Aban.` | `null` | `false` | 1 | washout | 2057 (2015) |

- **Finished:** `status === "Finished"` and `draw_noresult === null`.
- **No-result:** `draw_noresult === "no-result"`. This can come with `"Aban."` *or* `"Finished"`, so status alone is not enough.
- **Partial play vs washout (spec §5.8):** a washout has no `balls` (and no batting, bowling, runs or scoreboards). A partial-play no-result has balls.
  - **m44 (65586):** `Aban.`, `no-result`, note `"No result"`. PBKS 201/4 (S1, 20 overs), KKR 7/0 (S2, 1 over, 7 ball records). Partial play.
  - **65597 (m55):** `Aban.`, `no-result`, note `"No result"`. DC 133/7 in S1 (123 ball records), no S2. Partial play.
  - **65610 (m58):** `Aban.`, `no-result`, note `"Match abandoned without a ball bowled"`. `lineup`, `batting`, `bowling`, `balls`, `runs` and `scoreboards` are all `[]`. A washout.
  - **59270 (2024 m70):** a washout **after the toss**, with note `"No result (abandoned with a toss)"`. It has a full 32-player `lineup` but no balls. Of the 6 washouts in the archive, only this one has a lineup.
- **Live statuses:** not observed. No fixture in the archive was in progress, scheduled or postponed when it was fetched. Confirm them in gate 7 during the live trial.

---

## 2. Phases: regulation vs Super Over

### 2.1 Codes (from m32)

| Collection | Regulation | Super Over | m32 evidence |
|---|---|---|---|
| `data.batting[].scoreboard` | `S1`, `S2` | `S3`, `S4` | Hetmyer has rows on `S2` (15 runs) and `S3` (6). KL Rahul has rows on `S1` (38) and `S4` (7). |
| `data.bowling[].scoreboard` | `S1`, `S2` | `S3`, `S4` | Sandeep Sharma has rows on `S1` (4 overs, 33 runs) and `S4` (0.4 overs, 13 runs). Starc has rows on `S2` and `S3` (0.5 overs, 11 runs). |
| `data.balls[].scoreboard` | `S1`, `S2` | `S3`, `S4` | 262 balls in all. `S3` has 6 records (5 legal + 1 no-ball). `S4` has 4. |
| `data.scoreboards[].scoreboard` | `S1`, `S2` | `S3`, `S4` | each code has a `type: "extra"` row and a `type: "total"` row. `S3` total is 11/2 in 0.5 overs. `S4` total is 13/0 in 0.4 overs. |
| `data.runs[].inning` | 1, 2 | 3, 4 | `runs[]` **includes** the Super Over innings (inning 3: RR 11/2 in 0.5 overs; inning 4: DC 13/0 in 0.4 overs) |

- **Rule:** `phaseOfScoreboard("S1"|"S2") = "regulation"`. Any `"S<n>"` with n ≥ 3 is `"super_over"`.
- `runs[].inning` N is the same innings as scoreboard `"SN"`. Team, total, wickets and overs agree on all 585 innings from 2023–2026.
- There is no per-innings Super Over field. The only markers are the fixture's `super_over` flag and the code being ≥ S3. Across all 926 fixtures, `S3`+ appears only when `super_over: true`.
- Super Over ball numbers run `0.1` … `0.6`.

### 2.2 Gate 3: partly met

- **2019–2026:** the first Super Over is fully present (S3/S4 in batting, bowling, balls and scoreboards) for every Super Over fixture.
- **Repeat Super Overs are missing.** 2020 m36 (15267, KXIP v MI) had two Super Overs. Only the first (S3: 5/2, S4: 5/1) is in the data. There is no S5/S6 anywhere, and `runs[]` stops at inning 4.
- **2013–2017 Super Over ties have no Super Over detail.** For 15753, 15795 (2013), 2036 (2015) and 2447 (2017), `runs[]` has innings 3 and 4 but batting, bowling, balls and scoreboards have only S1/S2. 15609 (2014) has S3 only.
- **Fallback (§12.3 gate 3):** commissioner override per fixture. The normalizer should flag a `super_over: true` fixture whose `runs[]` innings ≥ 3 have no matching ball records. No existing `FlagCode` fits exactly. The nearest is `ball_data_missing`.

---

## 3. Batting record: `data.batting[]`

| Field | Meaning | m64 Marsh example |
|---|---|---|
| `player_id` | batter | `31` |
| `team_id` | **batting** team (matches the batter's `lineup.team_id`) | `1979` |
| `scoreboard` | innings code (§2) | `"S1"` |
| `score` | runs credited to the batter | `117` |
| `ball` | balls faced. **Excludes wides, includes no-balls** (matches the ball-by-ball count, §7) | `64` |
| `four_x` | boundary fours | `10` |
| `six_x` | sixes | `8` |
| `score_id` | dismissal, as an id in the `/scores` catalog (§4). `84` = `Not Out` | `54` (`Catch Out`) |
| `wicket_id` | always equal to `score_id` (1135/1135 in 2025) | `54` |
| `catch_stump_player_id` | fielder for catch, stumping or run-out (§5) | `128` |
| `runout_by_id` | second run-out fielder (§5.2) | `null` |
| `bowling_player_id` | bowler credited for bowler-credited kinds. `null` for run-out, not out and retired | `36509` |
| `batsmanout_id` | always `null` on batting records (2025). Use `balls[].batsmanout_id` instead | `null` |
| `sort`, `fow_score`, `fow_balls`, `rate`, `active`, `updated_at` | batting order, fall-of-wicket score and over, strike rate (rounded integer, e.g. `183`), live flag | — |

- A player who did not bat has **no** batting record. A not-out batter who faced no balls does have one (`ball: 0`, `score_id: 84`). There are 11 batting rows with 0 balls in 2025, including run-outs of a non-striker who faced no balls.
- Card and balls agree on runs, balls, fours and sixes for 1129/1135 batting rows in 2025. The 6 that disagree are all in 65546, which has a gap in its ball data (§11).

---

## 4. Dismissals: `score_id` → `/scores` → `DismissalKind`

The `/scores` catalog body is `{ data: [{ id, name, runs, four, six, bye, leg_bye, noball, noball_runs, is_wicket, ball, out }] }` with 103 entries. The same catalog serves batting records and balls. Each ball also carries the full score object at `balls[].score`, and it matches the catalog entry for every 2025 ball.

**Batting-record names.** Counts are batting rows: 2025 regulation + 2025 Super Over / all 926 fixtures.

| `score_id` | Catalog `name` | 2025 REG + SO | All seasons | Maps to |
|---:|---|---:|---:|---|
| 54 | `Catch Out` | 610 | 7263 | `caught`. **`caught_and_bowled` when `catch_stump_player_id === bowling_player_id`** (21 of the 610 in 2025, e.g. m29 KL Rahul c & b Karn Sharma) |
| 55 | `Catch Out (Sub)` | 12 | 164 | `caught` (substitute fielder) |
| 79 | `Clean Bowled` | 134 | 1751 | `bowled` |
| 58 | `Bowled` | 0 | 0 | `bowled` (in the catalog, never used) |
| 83 | `LBW OUT` | 52 | 662 | `lbw` |
| 56 | `Stump Out` | 18 | 252 | `stumped` |
| 57 | `Stump Out (Sub)` | 0 | 1 | `stumped` (substitute) |
| 21 | `1 Wide + stump Out` | 0 | 1 (2019) | `stumped` |
| 87 | `Hit Wicket` | 3 | 15 | `hit_wicket` |
| 63 | `Run Out` | 36 + 2 | 762 | `run_out` |
| 64 | `Run Out (Sub)` | 1 | 18 | `run_out` (substitute; §5.3) |
| 84 | `Not Out` | 260 + 3 | 3301 | `not_out` |
| 85 | `Retired Hurt` | 2 | 20 | `retired_hurt` (m32 Sanju Samson; 65612) |
| 138 | `Retired Out` | 2 | 2 | `retired_out` (65558, 65564) |
| 78 | `Obstructing the Field Out` | 0 | 4 | `obstructing_field` |
| 80 | `Absent` | 0 | 2 (2013, 2019) | unknown → flag `unknown_dismissal` (no `DismissalKind`; catalog `out: false`) |
| 81 | `Absent Hurt` | 0 | 0 | unknown → flag |
| 86 | `Hit the ball twice` | 0 | 0 | unknown → flag (no `DismissalKind` for it) |
| `null` | — | 0 | 1 (2016 fixture 2207) | unknown → flag |

- The 2025 total is 1135 batting rows, which is the sum of the 2025 column.
- No catalog entry exists for **timed out** or **handled the ball**. If they ever appear, they reach the normalizer as an unknown name, and get `unknown_dismissal`.
- **Caught and bowled has no score name of its own.** `dismissalKindFromScoreName("Catch Out")` can only return `caught`. The batting normalizer must upgrade it to `caught_and_bowled` when the catcher is the bowler.
- **`isSubstituteDismissal(name)`:** true exactly when the name ends in `(Sub)`. Catalog ids: 55, 57, 64, 66 (`Run Out + 1 Run (Sub)`, a ball-only name).
- **Ball-level wicket names** are a larger set than the batting-record names. They include runs and extras. Examples: m29 has a ball with `Run Out + 1 Run (Sub)` (66) whose batting record says `Run Out (Sub)` (64), and a ball with `1 Wide + stump Out` (21) whose batting record says `Stump Out` (56). See §6.3.

---

## 5. Fielding

### 5.1 Catch and stumping fielder

- **Path:** `data.batting[].catch_stump_player_id`.
- In 2025, all 622 caught (54, 55) and all 18 stumped (56) records have it set.
- Examples: m69 Hardik Pandya (281) `Catch Out`, `catch_stump_player_id: 623` (Inglis); m64 has two catches by sub 9459.
- The same id appears on the wicket ball as `data.balls[].catchstump_id`. Ball and batting fielder ids agree on 865 of 866 wicket balls in 2025. The exception is 65546 S2 16.1: the ball says `null` and the batting record says `7389`. The batting record is the more complete source.
- Older seasons have caught records with no fielder (2013: 5, 2014: 2, 2015: 3, 2017: 2, 2018: 7, 2019: 3, 2024: 2 [58346, 58370], 2026: 1 [69649]). These must be flagged, never inferred. 2025 has none.

### 5.2 Run-out fielder (gate 1): the data does not match the spec

- **Spec §5.6:** "Only the credited fielder scores a run-out. In Sportmonks this is the `runoutby` relation on the dismissed batter's batting record." That relation is the field `data.batting[].runout_by_id`. On the ball it is `data.balls[].runout_by_id`.
- **What the data shows (2025, 39 run-outs, 2 of them in the Super Over):**

| Shape | Count | `catch_stump_player_id` | `runout_by_id` | Example (m29) |
|---|---:|---|---|---|
| Two fielders | 22 | first fielder (inferred: the one who gathered and threw) | second fielder, at the stumps. In all 22 it is the designated wicketkeeper (12) or the bowler of that delivery (10) | Ashutosh Sharma: 3806 Will Jacks / **662 Ryan Rickelton (WK)** |
| One fielder | 17 | the fielder | **`null`** | Mohit Sharma: 227 Mitchell Santner / `null` |
| No fielder | 0 | `null` | `null` | — |
| `runout_by_id` only | 0 | — | — | — |

- `catch_stump_player_id` and `runout_by_id` are never the same player. All named fielders are in the lineup.
- **All seasons (780 run-outs):** `runout_by_id` is **never** set in 2013–2020 (486 run-outs). From 2021 it is set only on two-fielder run-outs: 10/46, 35/61, 33/55, 29/52, 22/39 and 18/41 for 2021–2026. `catch_stump_player_id` is set on 773/780. The other 7 (2013: 1, 2017: 1, 2018: 4, 2021: 1) have no fielder at all.
- **Following the spec (what Task 7 implements unless the commissioner rules otherwise):**
  - Credit the run-out to `runout_by_id`.
  - When it is `null`, add a `runout_fielder_missing` flag. Put the `catch_stump_player_id` value in the flag detail for the commissioner. Do not credit it.
  - Effect in 2025: 17 of 39 run-outs flagged. All 486 run-outs from 2013–2020 flagged.
  - In two-fielder run-outs, the keeper or bowler who broke the stumps gets the 8 points and the thrower gets 0.
  - In m29 this gives: Rickelton +2 run-outs (Ashutosh and Kuldeep), and a flag for Mohit Sharma (Santner).
- **Gate 1 verdict:** it fails as written. `runoutby` does not identify a fielder for every run-out.
  - Fallback (§12.3): the commissioner confirms run-out credit per dismissal, and every run-out missing a fielder is flagged.
  - **Commissioner decision needed:** whether a lone `catch_stump_player_id` on a run-out counts as "the fielder credited by the source". That would clear the 17 + 486 flags. Also decide which of the two fielders in a two-fielder run-out is credited, and whether Cricsheet (§12.1) should follow the same choice.

### 5.3 Substitute fielders (gate 2): met for 2025

- **Marker:** the score name ends in `(Sub)`. The substitute's id is in `catch_stump_player_id`. For `Run Out (Sub)` the `(Sub)` refers to the `catch_stump_player_id` fielder, not to `runout_by_id`.
- **2025:** 13 substitute dismissals. All 13 have `catch_stump_player_id` set, and all 13 ids are in `data.lineup[]` with `lineup.substitution: true`:
  - 12 × `Catch Out (Sub)`: 65546, 65550, 65557, 65558, 65569, 65575, 65577, 65595, m64 ×2 (Ravi Bishnoi 9459), m63 (Raj Angad Bawa 35051) and 66242.
  - 1 × `Run Out (Sub)`: m29 Kuldeep Yadav. `catch_stump_player_id` 35051 Raj Angad Bawa (sub), `runout_by_id` 662 Rickelton (not a sub).
- Under the spec-literal rule in §5.2, the m29 sub run-out is credited to Rickelton, and the substitute (Bawa) gets nothing.
- **All seasons:** 183 substitute dismissals. 181 name the substitute, and he is in the lineup. The 2 without an id are in 2019 fixture 10007 (two `Catch Out (Sub)`). These get `sub_fielder_unidentified`.
- **Substitute not in the lineup:** this never occurs in 2025. Every id used in `batting`, `bowling` and `balls` (batters, bowlers, fielders, non-strikers) is in that fixture's `lineup`, with 0 exceptions across 74 fixtures. Task 7's synthetic `999999` case is still the right guard.

---

## 6. Balls: `data.balls[]`

### 6.1 Record shape and over encoding

- **Fields:** `id`, `fixture_id`, `team_id` (**batting** team), `scoreboard`, `ball`, `batsman_id` (striker), `bowler_id`, `batsmanout_id` (the dismissed player), `catchstump_id`, `runout_by_id`, `batsman_one_on_creeze_id`, `batsman_two_on_creeze_id`, `score_id`, `score` (the full catalog object), `batsman`, `bowler` (embedded player resources, with `position`), `team`, `updated_at`.
- **`ball` is `over_index + legal_ball/10`.** The over index starts at 0, so values run from `0.1` to `19.6`, and `0.1`–`0.6` in a Super Over.
- A wide or no-ball **does not** advance the number. The next delivery reuses it: m32 S1 has `12.4` `1 Wide` followed by `12.4` `Catch Out`, and `19.2` appears five times (3 wides, 1 no-ball, then the legal ball).
- **Over grouping:** `scoreboard` + `Math.floor(ball)`. Add `bowler_id` for per-bowler maidens: 4 overs in 2025 are split between two bowlers, e.g. m64 S2 over 6, where Akash Maharaj Singh bowled `5.1` and Avesh Khan bowled `5.2`–`5.6`.
- No (scoreboard, `ball`) value has two legal deliveries in 2025, and no over has more than 6 legal balls.
- **Ordering:**
  - The array is sorted by `id`, but **not always chronological.** 2025 has 13 places where `ball` goes backwards, e.g. 65584 S2 `19.6` → `18.4`, where the later record also has a later `updated_at`.
  - Do not rely on array order. All the scoring aggregates (sums, counts, per-over grouping) do not depend on order.
- **Dismissed player:** `batsmanout_id`. It is not always the striker. In m32 S1 `3.1`, the striker is 23910 and the dismissed player is 2912 (Karun Nair, run out at the non-striker's end).
- **Super Over balls are included** in `balls[]`: m32 has `S3` and `S4` records.

### 6.2 What each delivery means (all from `balls[].score`)

| Quantity | Rule | Evidence |
|---|---|---|
| Wide delivery | `score.ball === false` and the name contains `Wide`. Catalog ids 17, 18, 20, 21, 22, 31, 32, 40, 46, 52. **The score object has no wide flag.** Other `ball:false` entries (50 `5 Penalty`, 80/81 `Absent`, 138 `Retired Out`) never appear on a 2025 ball. | 2025: `1 Wide` ×643, `2 Wides` ×25, `3 Wides` ×1, `5 Wides` ×23, `1 Wide + stump Out` ×4, `1 Wide + Run Out` ×2 |
| Wide runs (charged to bowler) | `score.runs` (plus `score.bye` for id 18 `1 Wide + 4 Bye`, never seen) | m69 Vyshak: `1 Wide` + `5 Wides` + `1 Wide` = 3 deliveries, 7 runs |
| No-ball delivery | `score.noball === 1` (a 0/1 flag) | m32 S3 `0.4` `1 No Ball + Four` |
| No-ball runs | `score.noball_runs`. It is always 1 per no-ball in the whole archive. | — |
| Legal delivery | not a wide and `score.noball === 0` | — |
| Batter runs | wide → 0; otherwise `score.runs − score.noball_runs`. Byes and leg-byes have `runs: 0`. | Parag `1 No Ball + Four`: runs 5, noball_runs 1, so the batter gets 4, `four: true` |
| Ball faced by batter | every non-wide (no-balls count) | matches `batting[].ball` on all 2025 rows with complete balls |
| Byes / leg-byes | `score.bye` / `score.leg_bye` (run counts). The ball still has `bowler_id`, but these runs are **not** charged to the bowler | m69 S2 `15.2` `1 Bye`; `1 Leg Bye` ×187 in 2025 |
| Four / six | `score.four` / `score.six`. Only score a four when `bye === 0 && leg_bye === 0`: catalog ids 38/44 (`3/4 Leg Byes + 4`) have `four: true` but never occur. All-run fours (`4 Runs`, id 72) and overthrows (`4 Runs (Throw)`, id 48) have `four: false`. | 2025: `FOUR` ×2238, `1 No Ball + Four` ×7, `SIX` ×1285, `1 No Ball + Six` ×7 |
| Runs conceded by bowler | wide → wide runs; otherwise `score.runs`. This includes no-ball runs and excludes byes and leg-byes. | matches `bowling[].runs` 863/863 (§7) |
| Team runs (for dots) | `score.runs + score.bye + score.leg_bye` | — |
| Dot | legal and team runs = 0. A wicket or a 0-run run-out on a legal ball counts. Byes and leg-byes do not. | m63 Bumrah 12 dots |
| Wicket | `score.is_wicket` / `score.out`. Dismissed player: `batsmanout_id`. | — |

**Penalty runs:**

- `data.scoreboards[].penalty` is 5 in only one place in the archive (2014 fixture 15600 S2).
- Score ids 50/51 (`5 Penalty…`) never appear on a ball.
- Penalty runs are not credited to any player, so they have no scoring effect.

### 6.3 Wicket balls (2025) and bowler credit

- **Bowler-credited (`wickets`):** `Catch Out` (54) ×609, `Catch Out (Sub)` (55) ×12, `Clean Bowled` (79) ×133, `LBW OUT` (83) ×52, `Stump Out` (56) ×14, `1 Wide + stump Out` (21) ×4, `Hit Wicket` (87) ×3.
  - Also bowler-credited, but not seen on any 2025 ball: `Bowled` (58), `Stump Out (Sub)` (57; once in the archive), `1 Wide + Hit Wicket` (20).
- **Not bowler-credited:** `Run Out` (63) ×23, `Run Out + 1 Run` (65) ×13, `Run Out + 1 Run (Sub)` (66) ×1, `1 Wide + Run Out` (22) ×2.
  - Other catalog run-out variants: 3, 5, 23, 24, 25, 28, 29, 32, 36, 42, 64, 67, 68.
  - Also not bowler-credited: `Obstructing the Field Out` (78), `Retired Out` (138) and `Hit the ball twice` (86).
- **Retirements** (`Retired Hurt`, `Retired Out`) are **not** ball records in 2025. They appear only on batting records.

### 6.4 Gate 4: met for 2025, with two exceptions

- **Ball data present:** 73 of 74 fixtures. The one without is 65610, the washout, so there is nothing to record.
- **Gap inside a finished fixture:** 65546 (m4) S2 has 97 ball records covering 93 legal balls against 19.3 overs (117) on the card. All 24 legal balls of bowler 7389 are missing (§11).

---

## 7. Bowling card: `data.bowling[]`

| Field | Meaning | Check against balls (2025, 865 rows) |
|---|---|---|
| `player_id`, `team_id` | bowler and the **bowling** team | — |
| `scoreboard` | innings code (§2) | — |
| `overs` | `overs.balls` notation: `3.2` = 3 overs 2 balls = 20 legal balls | legal balls = `floor(overs)*6 + round(frac*10)` on 863/863 rows that have balls |
| `medians` | maidens | equals ball-derived maidens (6 legal balls by that bowler in a scoreboard+over, 0 bowler-charged runs) on 865/865 |
| `runs` | runs conceded (batter runs + wides + no-balls; **excludes** byes and leg-byes) | 863/863 |
| `wickets` | bowler-credited wickets | 863/863 |
| `wide` | **wide RUNS, not wide deliveries** | equals wide runs on 863/863. In the 46 rows where the two differ, card = runs 46 times and deliveries 0 times. Example: m69 Vyshak `wide: 7` = 3 deliveries (1 + 5 + 1). The same holds in every season 2013–2026 (the only exceptions are 9 rows in 2019–2021). |
| `noball` | no-ball count | equals no-ball deliveries on 863/863. Every no-ball in the archive has `noball_runs: 1`, so this cannot tell deliveries from runs |
| `rate` | economy, rounded (`3.6`) | — |
| `active`, `sort`, `id`, `updated_at` | live flag, order | — |

**The 2 rows that do not match:**

- 65546 S2, bowler 7389: 4 overs with no balls. This is the ball-data gap (§11).
- m44 S2, bowler 4880 (Arshdeep): `overs: 0`, `runs: 0`. A phantom row; he bowled no ball before the rain.

**Effect on the card fallback (gate 4 / Task 8):**

- Card `wide` can't produce `wideDeliveries` whenever a multi-run wide was bowled. Keep `wideDeliveries` and `noBallDeliveries` `null` when using the card, as Task 8 already plans.
- When comparing card with balls (`bowling_card_mismatch`), compare card `wide` with ball-derived wide **runs**, not deliveries.

**Bumrah m63, card vs balls.** Card: `overs 3.2, medians 0, runs 12, wickets 3, wide 0, noball 0, rate 3.6`. Balls agree: 20 legal, 12 conceded, 3 bowler-credited wickets (`LBW OUT` 9.2, `Clean Bowled` 15.3 and 18.2), 0 wides, 0 no-balls, 0 maidens.

---

## 8. Lineup: `data.lineup[]`

- **Shape:** each entry is a player resource. Fields: `id` (player id), `fullname`, `firstname`, `lastname`, `position`, `battingstyle`, `bowlingstyle`, `country_id`, `dateofbirth`, `image_path`, `updated_at`. Plus a `lineup` pivot object: `{ team_id, captain, wicketkeeper, substitution }`.
- **Size:** 2025 has 32 entries per fixture, 16 per team. 0 entries for the washout 65610. Seasons 2013–2022 have 22–24 entries (one 2017 fixture has 44). 2023 has 24–32. 2024–2026 have 31–32.
- **Captain:** `lineup.captain`. Exactly 1 per team in 146 of 146 team-matches.
- **Wicketkeeper:** `lineup.wicketkeeper`. Exactly 1 per team in 146 of 146.
- **Impact-substitute marker:** `lineup.substitution`. In every 2025 team-match, 11 players have `false` and 5 have `true`.
  - `true` marks the **five named substitutes**. It does **not** show which one came on as Impact Player.
  - Which one played can only be inferred from who batted or bowled. 135 team-matches had exactly 1 substitute who batted or bowled, 10 had none, and 1 (65598 MI) had 2 (Karn Sharma, Ashwani Kumar).
  - Substitute fielders (e.g. Ravi Bishnoi in m64) are also `substitution: true` players.
  - Gate 5 (spec §7.4 "in XI including impact substitutes"): the XI is the `substitution: false` players. The five substitutes are listed, but the used Impact Player is not marked before he plays.
- **Coverage:** every player id that appears in `batting`, `bowling` or `balls` (including fielders and non-strikers) is in the lineup, with 0 exceptions in 2025.

---

## 9. Player position

- **Path:** `data.lineup[].position.{id,name}`. It is also embedded at `data.balls[].batsman.position` and `data.balls[].bowler.position`.
- It is the player's **current profile** position, the same in every fixture, so it is not historical.

| `position.id` | `position.name` | 2025 distinct players | Lineup appearances, all seasons |
|---:|---|---:|---:|
| 1 | `Batsman` | 51 | 5823 |
| 2 | `Bowler` | 90 | 8161 |
| 3 | `Wicketkeeper` | 30 | 3258 |
| 4 | `Allrounder` | 53 | 5415 |
| 5 | `Top Order Batter` | 0 | 42 |
| 8 | `Middle Order Batter` | 1 | 82 |
| 11 | `Bowling Allrounder` | 3 | 382 |
| 14 | `Batting Allrounder` | 2 | 113 |

Spec §7.2 says Sportmonks has exactly four positions. The data has eight (§11).

---

## 10. Golden cross-check (spec §5.9, handoff values)

Source values come from the exported fixtures. Card values and ball-derived values were both computed and both agree.

| Case | Handoff | Source (card) | Source (balls) | Verdict |
|---|---|---|---|---|
| Marsh, m64 (player 31, S1) | 117 off 64, 10×4, 8×6 | `score 117, ball 64, four_x 10, six_x 8` (out `Catch Out`, fielder 128) | 117 runs, 64 balls faced (65 deliveries including 1 wide; also faced 2 leg-byes), 10 fours, 8 sixes | **match**. No bowling or fielding for Marsh in m64. |
| Inglis, m69 (player 623, S2) | 73 off 42, 9×4, 3×6, 1 catch | `score 73, ball 42, four_x 9, six_x 3` (out `LBW OUT`). Fielding: 1 `Catch Out` (Hardik Pandya, S1) | 73 / 42 / 9 / 3 | **match**. No bowling, stumping or run-out. |
| Bumrah, m63 (player 284, S2) | 3/12, 20 legal balls, 12 dots | `overs 3.2, runs 12, wickets 3, medians 0, wide 0, noball 0` | 20 legal, 12 conceded, 12 dots, 0 wides, 0 no-balls, 0 maidens, 3 wickets | **match**. Did not bat. No fielding. |
| KL Rahul, m32 SO (47, S4) | 7 runs incl. 1 four | `score 7, ball 3, four_x 1, six_x 0`, `Not Out` | `2 Runs`, `FOUR`, `1 Run` | **match** |
| Stubbs, m32 SO (25797, S4) | 6 incl. 1 six | `score 6, ball 1, six_x 1`, `Not Out` | `SIX` | **match** |
| Hetmyer, m32 SO (108, S3) | 6 incl. 1 four | `score 6, ball 4, four_x 1`, `Not Out` | `No Run`, `FOUR`, `1 Run`, `Run Out + 1 Run` (non-striker Jaiswal out) | **match** |
| Parag, m32 SO (4922, S3) | 4 incl. 1 four | `score 4, ball 2, four_x 1`, `Run Out` | `1 No Ball + Four` (batter 4), then `Run Out` (0) | **match**. His four came off a no-ball. |
| Sandeep Sharma, m32 SO bowling (2966, S4) | 4 legal balls, 13 conceded, 0 dots | `overs 0.4, runs 13, wickets 0, wide 0, noball 0` | 4 legal, 13 conceded, 0 dots | **match** |

**Verdict:** every handoff value matches the source. No change to any test or expected value is needed.

**Information only (not in the handoff deltas):** m32's Super Over also has these events.

- **Starc's Super Over bowling (S3):** 5 legal balls, 11 conceded, 1 no-ball, 2 dots (`0.1` and the 0-run run-out at `0.4`), 0 wickets.
- **Two Super Over run-outs:**
  - Parag: `catch_stump_player_id` 47 KL Rahul, `runout_by_id` 36 Starc.
  - Jaiswal: `catch_stump_player_id` 4949 Fraser-McGurk, `runout_by_id` 36 Starc.
- Under the spec-literal rule (§5.2), Starc gets 2 Super Over run-outs. Under a `catch_stump_player_id` rule, Rahul and Fraser-McGurk get one each.
- If a golden test asserts on Super Over fielding, it needs the §5.2 decision first.

---

## 11. Surprises that change normalizer rules

1. **Run-out credit (gate 1).** `runout_by_id` is the second, stump-end fielder, and it is `null` for every single-fielder run-out. It is also `null` for every run-out from 2013–2020. See §5.2: following the spec flags 17 run-outs in 2025 and 486 in 2013–2020. **Needs a commissioner decision.**
2. **Bowling card `wide` is wide runs.** The card fallback cannot give per-delivery wide penalties. When reconciling, compare card `wide` with wide runs (§7).
3. **Caught and bowled is not a score name.** Derive it from `catch_stump_player_id === bowling_player_id` (21 in 2025). Bowled is `Clean Bowled` (79). The catalog's `Bowled` (58) is never used.
4. **Wides have no flag.** Identify them by `score.ball === false` plus the name containing `Wide` (§6.2). `score.ball` is `true` for no-balls, so a legal ball is "not a wide and `noball === 0`", not `score.ball`.
5. **A partial ball-data gap inside a finished fixture: 65546 (m4) S2.**
   - All of bowler 7389's balls are missing (24 legal).
   - 6 batting rows and 1 bowling row do not reconcile, and one wicket ball has no fielder id.
   - Task 8's rule "`balls` absent → card fallback" only covers whole-fixture absence. Detect gaps per innings: compare ball-derived legal balls with `runs[].overs`, or each bowler's balls with his card `overs`. Then use the card for the affected bowler with `ball_data_missing`, or raise `bowling_card_mismatch`.
   - In 2025 this is the only gap. Older seasons have more: 2019 has 31 batting and 63 bowling rows that don't reconcile. They include balls credited to the wrong bowler, e.g. in 9740 S1 bowler 2906 has 30 legal balls against a 4-over card.
6. **Ball array order is not chronological** (13 times in 2025). Group by fields, never by position (§6.1).
7. **Phantom 0-over bowling row** (m44 Arshdeep, `overs: 0`, no balls). Treat it as "did not bowl" (`bowling: null`), not as a zero line.
8. **Repeat Super Overs are missing, and Super Over detail is missing before 2019** (§2.2). This affects spec §5.8 "include every Super Over".
9. **Positions:** there are 8 values, not 4. Suggested mapping onto WK/BAT/ALL/BWL (spec §7.2): 3 → WK; 1, 5, 8 → BAT; 4, 11, 14 → ALL; 2 → BWL. This needs the commissioner's confirmation. Positions are current-profile values, not historical.
10. **Status alone does not identify no-results.** Use `draw_noresult` and whether balls exist (§1).
    - Washouts may have an empty lineup (65610), or a full one if the toss happened (59270).
    - Task 7's synthetic washout (m44 with batting, bowling and balls emptied, lineup kept) matches 59270, not 65610.
11. **Impact Player is not marked.** `substitution` lists the 5 named substitutes (§8).
12. **Older-season ball oddities (none in 2025):**
    - `Not Out` (84) ×2 and `Retired Hurt` (85) ×3 appear as ball records with `ball: true`, `noball: 0` (fixtures 15759, 2210, 2345, 2570, 49016).
    - Each one fills one of its over's 6 legal slots (the over still has exactly 6 legal balls), so it is a real 0-run legal delivery. Count it as a legal dot. It is **not** a dismissal.
    - The catalog has inconsistent entries that are never seen in the archive: `1NB + 2 Run+ Run Out` (25) has `noball_runs: 0`; `1 Leg Bye + 4 Runs` (6) has `leg_bye: 5`; `3 No ball` (106) has `runs 3, noball_runs 2`. The normalizer should flag `unparseable_record` on these ids rather than trust the formula.
13. **Byes and leg-byes sit on the bowler's ball records** (`bowler_id` is set), but the card excludes them. The ball-derived rule in §6.2 reproduces the card on 863/863 rows.
14. **Ids are numbers, and there are extra fields.** The zod schemas should parse only the fields named here and allow unknown keys. `weather_report: []` appears on many fixtures.
