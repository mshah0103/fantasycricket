# Cricket Fantasy League — MVP Design

- **Date:** 2026-11-21
- **Status:** Approved by the commissioner, 2026-11-23
- **Scoring rules version:** `t20-v0.7` (supersedes `t20-sim-v0.6` in `CRICKET_FANTASY_RULES_AND_HANDOFF.md`, revision 1.0)
- **Background:** `CRICKET_FANTASY_RULES_AND_HANDOFF.md` holds the research history, simulations, and the v0.6 rules. Where this document and the handoff disagree, this document wins.

Items marked **(my call)** were proposed by the designer and not explicitly chosen by the commissioner. They are reasonable defaults and can be changed. Everything else was decided by the commissioner (Malhar).

---

## 1. Intent

A private, self-hosted, season-long IPL fantasy league for a group of about 12 friends. It is a commissioner-run league in the style of Sleeper/Fantrax: live auction draft, head-to-head weekly matchups decided by accumulated points over five-fixture gameweeks, waivers, trades, and live scoring.

**Why:** Existing cricket fantasy products are built around daily contests. None offers a season-long head-to-head league with these rules.

**Target:** Run the league for the IPL 2027 league stage. The IPL 2027 auction is on 16 December 2026. The season start has not been announced and is expected in mid-to-late March 2027, possibly earlier. IPL 2027 is expected to keep the 74-match format (70 league matches + 4 playoffs).

**Success looks like:** The league runs the whole IPL 2027 league stage. Every score is correct and explainable from its breakdown. The commissioner never has to calculate anything by hand. Corrections are rare and take one action.

---

## 2. Goals, non-goals, anti-goals

### Goals (v1)

1. Google sign-in, invite-only, with commissioner, co-commissioner, and manager roles.
2. Player pool and positions synced from Sportmonks (IPL 2027 squads, including mid-season replacements).
3. A live auction draft room.
4. Per-gameweek lineups with per-player locks.
5. Live provisional scoring during matches, with points final after each gameweek closes.
6. Head-to-head matchups, standings, and a six-team playoff with reseeding.
7. Daily blind FAAB waivers plus instant free-agent adds.
8. Trades with commissioner veto and a trade deadline.
9. Player pages with a Sleeper-style game log and season history covering every available IPL season (section 12.1), scored under `t20-v0.7` with full point breakdowns. Positional rankings for the current and past seasons (section 12.2). Both are available from the auction room for draft prep.
10. Commissioner tools (section 13).
11. A mobile-first responsive web app.
12. A league activity log showing every transaction and commissioner action **(my call)**.
13. Weighted-average point projections (per match, per gameweek, rest of season) and matchup win probability (section 12.4).

### Non-goals (v1)

League chat, payments or fees, push or email notifications, native apps, multiple leagues or public sign-up, ball-by-ball commentary, injured reserve, captain/vice-captain multipliers, automatic bench replacement, competitions other than IPL (MLC etc.), keeper/dynasty leagues, proxy or auto-bidding in the auction.

The data model should still be scoped by league and season, so a second league or a second season later is not a rewrite. No UI for creating leagues is needed.

### Anti-goals (would make it a failure even if it technically works)

- A score that can't be explained point by point from its breakdown.
- Anyone being able to move, drop, or trade a locked player.
- A final score changing silently. Changes after a gameweek is final happen only through an explicit, logged commissioner reopen.
- Missing or unparseable source data being treated as zero without a visible flag.
- The commissioner having to compute or reconcile anything by hand during normal operation.

---

## 3. Constraints

- **Timeline:** Feature-complete by about 1 March 2027, to leave a buffer before the season starts. The auction room must be ready before the league's draft (late February or early March, after IPL squads settle). Playoff logic is needed only by GW12 (around early May) and is the one piece that may ship after the season starts.
- **Hosting:** Docker on the commissioner's Unraid server. Public HTTPS through a named Cloudflare Tunnel on a subdomain of the commissioner's existing Cloudflare-managed domain, so no router ports are opened. The Google OAuth redirect URI uses that subdomain.
- **Data source:** Sportmonks Cricket API v2 (`https://cricket.sportmonks.com/api/v2.0`). REST polling only, no webhooks or sockets. The Major plan (€29/month) includes the IPL, ball-by-ball data, batting and bowling cards, and lineups, with 2,000 calls per hour per endpoint.
  - **Subscription window (my call):** Start the 14-day trial when M0 begins, as the Big Bash starts in mid-December. Let it convert to paid Major and keep it running continuously through the end of the IPL league stage, about €175 for December–May. A gap would break squad and position sync, the December auction and replacement updates, and draft prep.
  - Archive every raw response from day one.
- **Scale:** About 13 users (12 managers, some overlap with commissioner roles). Low traffic, with bursts during matches and the auction.
- **Time zones:** Store all times in UTC. Scheduled league processing runs on `America/New_York` time. The UI shows times in each viewer's local zone **(my call)**. IPL matches start at about 06:00 and 10:00 Eastern during the season (15:30 and 19:30 IST).
- **Cost:** Sportmonks only. No other paid services are required.
- **Build method:** Agentic coding. Claude coding agents implement from a written plan, and the commissioner reviews. The plan must break the work into independently testable tasks with clear acceptance checks.
- **Format assumption:** 70 league fixtures and 5 fixtures per gameweek. Keep fixtures-per-gameweek and the fixture-to-gameweek assignment configurable, because the IPL is expected to expand to 94 matches from 2028.

---

## 4. Approaches considered

| Approach | Summary | Trade-offs | Outcome |
|---|---|---|---|
| **A. One TypeScript app** | Next.js + TypeScript + Postgres in Docker. One codebase runs a web app, a realtime server for the auction, and a background worker. Scoring engine rewritten in TypeScript, with the handoff's worked examples as tests. | One language for scoring, rules, and UI. A stack the commissioner already knows (Friendly Skies). The scoring rewrite is small, and the Sportmonks adapter is new work under any approach. | **Chosen** |
| B. Python backend + React frontend | FastAPI keeps the existing Python engine. React SPA. Worker and realtime in Python. | Reuses the engine, but two languages and duplicated data shapes. The bulk of the work (auction, locks, FAAB, trades) gains nothing from the old code, which was built around Cricsheet input. | Rejected |
| C. Next.js app + Python scoring microservice | Engine untouched behind an internal API. | The most moving parts (two runtimes, two containers, a network hop for every score) to preserve the smallest component. | Rejected |

Also ruled out:

- **Supabase:** Self-hosting it on Unraid is heavy for what plain Postgres plus a standard auth library provide.
- **SQLite:** It would cope with this scale, but Postgres is familiar and handles concurrent auction bids and transactional waiver runs more comfortably.
- **Cricsheet as a live or audit source:** Sportmonks supplies everything needed. Cricsheet is used only as a one-time fallback for past seasons if the Sportmonks plan lacks them (section 12, gate 6).

---

## 5. Scoring rules `t20-v0.7`

A player's gameweek score is the sum of his match scores for the matches in that gameweek. Negative match and gameweek scores are allowed. Bonuses and penalties are calculated per match, before gameweek accumulation. Use exact rates for all band comparisons, with no rounding before comparison.

**Changes from v0.6:**

1. A run-out awards 8 points only to the single fielder credited by the data source. Assisting fielders get 0.
2. Wide and no-ball penalties apply per delivery, not per extra run.
3. Substitute fielders score their catches and run-outs.
4. Partial-play no-results, washouts, and postponed matches are handled as in section 5.8.

### 5.1 Batting events

| Event | Points |
|---|---:|
| Run credited to the batter | +0.5 |
| Four (boundary) | +1 in addition to run points |
| Six (boundary) | +1.5 in addition to run points |
| Dismissed for zero in regulation play | −3 |

- Four or six runs completed by running or overthrows earn no boundary bonus.
- A batter finishing on zero not out gets no duck penalty. Batting position gives no exemption.
- **Dismissal edge cases (my call):** Retired hurt is not a dismissal, so no duck. Retired out, obstructing the field, timed out, and handled the ball count as dismissals for the duck rule but give no bowler wicket.

### 5.2 Batting milestones (highest one only, regulation runs)

| Runs | Bonus |
|---|---:|
| 0–9 | 0 |
| 10–24 | +1 |
| 25–49 | +2 |
| 50–74 | +3 |
| 75–99 | +5 |
| 100–149 | +8 |
| 150+ | +10 |

### 5.3 Batting strike rate

Strike rate = `100 × regulation runs / regulation balls faced`. It applies only when at least 10 balls were faced. Balls faced exclude wides and include no-balls faced.

| Strike rate | Points |
|---|---:|
| < 60 | −5 |
| 60 to < 80 | −3 |
| 80 to < 100 | −1 |
| 100 to < 120 | 0 |
| 120 to < 140 | +1 |
| 140 to < 160 | +2 |
| 160 to < 180 | +3 |
| 180 to < 220 | +4 |
| 220 to < 260 | +5 |
| 260 to < 300 | +6 |
| ≥ 300 | +7 |

### 5.4 Bowling events and milestones

| Event | Points |
|---|---:|
| Wicket credited to the bowler | +15 |
| Extra points for bowled or LBW | 0 |
| Dot ball (legal delivery, zero team runs) | +0.5 |
| Maiden over | +10 |
| Wide (per wide delivery, regardless of runs) | −1 |
| No-ball (per no-ball delivery, regardless of runs) | −2 |

| Regulation wickets | Milestone bonus (highest only) |
|---|---:|
| 0–2 | 0 |
| 3 | +4 |
| 4 | +6 |
| 5+ | +8 |

- **Bowler-credited dismissals:** bowled, caught, caught and bowled, LBW, stumped, hit wicket. Run-outs give the bowler no wicket.
- Caught and bowled earns the bowler both the wicket and the catch.
- A stumping earns the bowler the wicket and the wicketkeeper the stumping.
- A zero-run wicket delivery also counts as a dot.
- A leg-bye or bye delivery is not a dot, because team runs were scored.
- **Maiden:** six legal balls by that bowler in the over, with zero runs charged to the bowler. Byes and leg-byes don't spoil a maiden. Wides and no-balls do, because they are charged to the bowler.

### 5.5 Bowling economy

Economy = `6 × regulation runs conceded / regulation legal balls`. It applies only with at least 12 legal balls. Runs conceded include batter runs, wides, and no-balls, and exclude byes and leg-byes. Legal balls exclude wides and no-balls. Extra penalties apply in addition to economy.

| Economy | Points |
|---|---:|
| < 4 | +7 |
| 4 to < 5 | +5 |
| 5 to < 6 | +4 |
| 6 to < 7 | +3 |
| 7 to < 8 | +2 |
| 8 to < 9 | +1 |
| 9 to < 10 | 0 |
| 10 to < 11 | −1 |
| 11 to < 13 | −3 |
| 13 to < 15 | −5 |
| ≥ 15 | −7 |

### 5.6 Fielding

| Event | Points |
|---|---:|
| Catch (including caught and bowled) | +4 |
| Stumping | +8 |
| Run-out, to the single fielder credited by the source | +8 |

- Only the credited fielder scores a run-out. In Sportmonks this is the `runoutby` relation on the dismissed batter's batting record.
- Substitute fielders score catches and run-outs when the source identifies them. A substitute's fielding points count for whichever manager started him that gameweek.
- If a dismissal's fielder is missing from the source, record and flag it as missing data. Never assign it to someone by inference, and never silently score it as zero.

### 5.7 Not scored

Player of the Match, combined-performance bonuses, team win, appearance or starting-XI points, death-over economy, and captain/vice-captain multipliers are all 0 or absent.

### 5.8 Super Overs and unusual matches

- **Super Overs:** Calculate the regulation score first. Then add Super Over event points at the same rates: runs, boundary bonuses, bowler-credited wickets, dots, wide and no-ball penalties, maidens, catches, stumpings, and credited run-outs. Milestones, strike rate, economy, and duck penalties use regulation stats only. Include every Super Over if there are repeats. A Super Over belongs to its original match and gameweek. Store regulation and Super Over components separately so the total can be reproduced.
- **Partial-play no-result (abandoned after play started):** All actual events count, with normal minimums for strike rate and economy.
- **Washout (no balls bowled):** Zero events. The fixture still occupies its gameweek slot.
- **Rescheduled or postponed fixture:** Gameweek membership follows the fixture's current date (section 6).
  - **Moved before its gameweek goes live:** It moves automatically (logged) into the gameweek whose date window contains its new start time, and scores normally there.
  - **Not played as scheduled once its gameweek is live:** It counts as postponed. It scores nothing for fantasy, even if played later, and the gameweek closes without it. "As scheduled" means on the scheduled date frozen when the gameweek went live, compared as the venue's calendar date in IST **(my call)**. A rain delay that still starts on that date is not a postponement.
  - **Moved past the end of GW14's window:** Scores nothing.
  - The commissioner can override any of these per fixture (logged).

### 5.9 Worked examples (golden tests)

The first three come from real 2025 matches in the handoff and are unaffected by the v0.7 changes. Confirm each against the Sportmonks scorecard during the trial. If the source shows extras or other events the handoff did not, treat it as a reconciliation question, not a test failure to paper over.

| Case | Calculation | Points |
|---|---|---:|
| Marsh, IPL 2025 match 64: 117 off 64, 10×4, 8×6 | 58.5 + 10 + 12 + 8 milestone + 4 SR (182.8) | 92.5 |
| Inglis, IPL 2025 match 69: 73 off 42, 9×4, 3×6, 1 catch | 36.5 + 9 + 4.5 + 3 + 3 SR (173.8) + 4 | 60.0 |
| Bumrah, IPL 2025 match 63: 3/12, 20 legal balls, 12 dots | 45 + 4 milestone + 6 dots + 7 econ (3.6) | 62.0 |
| Constructed: 24 legal balls, 30 conceded including one 5-wide delivery, one 1-wide delivery, and one no-ball; 1 caught wicket; 8 dots | 15 + 4 dots + 2 econ (7.5) − 2 (two wide deliveries) − 2 (one no-ball) | 17.0 (v0.6 per-run rule would give 13.0) |
| Constructed: two-fielder run-out, source credits fielder X | X +8. Other fielder 0. Bowler 0 wicket points. Bowler +0.5 if no run was completed on a legal ball. | — |
| Constructed: 7 Super Over runs including one four, by a batter with 48 regulation runs | Regulation milestone stays +2. Super Over adds 3.5 + 1. | +4.5 added |
| Constructed: over with 6 legal balls, 2 leg-byes, nothing else | Maiden +10. 4 dots +2. The leg-bye balls are not dots. | 12.0 |

**Implementation:** Write the scoring engine as a pure function with no I/O. Input is a normalized player-match stat record (regulation and Super Over parts). Output is total points plus a list of components. Store every computed breakdown. The same function scores live, final, and historical matches.

---

## 6. League structure

- **Managers:** 12 teams. One Google account per manager. The commissioner is also a manager.
- **Gameweeks:** 14. At schedule import, each is a block of 5 IPL league-stage fixture slots by official match number (1–5, 6–10, … 66–70). IPL playoff matches are excluded. Membership is stored by Sportmonks fixture ID.
  - **Date windows:** At import, each gameweek also gets a fixed date window. It runs from the scheduled start of its first fixture to the scheduled start of the next gameweek's first fixture. GW14's window ends at 23:59 IST on the day of its last scheduled fixture **(my call)**.
  - **When fixtures move:** Windows never move. Fixtures move between them under the rules in section 5.8, so a gameweek can end up with more or fewer than 5 fixtures. A new fixture, such as a voided match's replay, joins the window containing its start time.
  - **Overrides:** The commissioner can reassign a fixture manually until its target gameweek goes live.
- **Regular season:** GW1–GW11 is a single round robin, so every team plays every other team once. The schedule is generated by the circle method with a random seed and published before the draft **(my call)**.
- **Matchup score:** The sum of a team's starters' points for that gameweek (section 7).
- **Record:** W–L–T. A tied matchup is recorded as a tie.
- **Standings order:** Win percentage, with a tie counted as half a win **(my call)**. Then total points for (PF). Then head-to-head result **(my call)**. Then commissioner decision **(my call)**.
- **Playoffs:** The top 6 qualify.
  - **GW12 quarterfinals:** #3 vs #6 and #4 vs #5. #1 and #2 have byes.
  - **GW13 semifinals, reseeded:** #1 vs the lowest remaining seed, #2 vs the other.
  - **GW14 final.**
  - A tied playoff matchup goes to the team with the higher regular-season PF. If that is also tied, the higher seed advances **(my call)**.
- **Eliminated and bye teams:** They can still manage rosters and make waiver claims. Their scores don't matter **(my call)**.

---

## 7. Rosters, positions, lineups, locks

### 7.1 Roster

| Slot | Count | Eligible positions |
|---|---:|---|
| WK | 1 | WK |
| BAT | 2 | BAT, WK |
| ALL | 1 | ALL |
| BWL | 2 | BWL |
| FLEX | 2 | Any |
| Bench | 4 | Any |

- 8 starters (WK 1, BAT 2, ALL 1, BWL 2, FLEX 2) plus 4 bench, for 12 players maximum. There is no IR.
- This changes the handoff's simulated lineup (ALL 2, FLEX 1), so the handoff's positional-balance numbers don't apply exactly to this format.
- A roster may drop below 12. An empty starting slot scores 0 **(my call)**.
- There are no limits on how many players of each position a team may hold.

### 7.2 Positions

- Positions come from Sportmonks, which has exactly four: Batsman → BAT, Bowler → BWL, Wicketkeeper → WK, Allrounder → ALL.
- One position per player, fixed for the season unless the commissioner overrides it (logged).
- If Sportmonks lacks a position for a player, the commissioner sets it, using the franchise's official squad page as the reference.

### 7.3 Player pool

- All players in the IPL 2027 season squads, according to Sportmonks.
- The worker syncs squads daily, so mid-season replacement signings appear automatically. The commissioner can also add or deactivate players manually.
- A player's franchise for fixture purposes comes from the season squad.
- **Mid-season replacements (my call):** There is no automatic transfer to the manager who owns the injured player. A newly synced player goes on waivers until the first daily run at least 12 hours after he appears, then becomes a free agent. This way nobody gains from being online when the sync runs.
- **Players who leave a squad (my call):** A rostered player who leaves his IPL squad stays on his fantasy roster, scoring 0 unless he plays, until his manager drops him. The UI marks him "not in squad".
- **Manual adds:** If the commissioner adds a player by hand before Sportmonks has him, the commissioner can later link that player to his Sportmonks record. This is data cleanup only, with no fantasy effect.

### 7.4 Lineups and locks

- **Lineups are stored per gameweek.** A new gameweek's lineup starts as a copy of the previous one and can be edited until each player locks for that gameweek.
- **Lock rule:** A player locks for a gameweek at the start of his franchise's first fixture in that gameweek. Once locked, he stays in his slot, starter or bench, for the rest of that gameweek.
  - The lock applies whether or not he is in the playing XI.
  - A player whose franchise has no fixture that gameweek never locks.
- **Lock time:** The fixture's scheduled start (`starting_at`), or earlier if Sportmonks reports the fixture live. A rain delay does not unlock **(my call)**.
- **Swaps:** Allowed between two unlocked players, subject to slot eligibility. The app prevents illegal placements.
- **Scoring:** A starter's gameweek points are the sum of all his fixtures in that gameweek, because he stays locked in the starting slot. A player on the bench at lock contributes 0 for the whole gameweek, even if he has two fixtures.
- **Locked players** cannot be dropped or traded until the gameweek they are locked in has closed (section 10).
- **Mid-week additions:** A player added after his first fixture of the gameweek has started lands on the bench, already locked for that gameweek.
- **Playing XI display:** Once Sportmonks publishes lineups (around the toss), rosters show whether each player is in his team's XI (including impact substitutes), so managers can swap unlocked players.

---

## 8. Auction draft

- **When:** Scheduled by the commissioner after IPL squads settle (late February or early March). Live, with all managers online.
- **Money:** Displayed in "M" with no currency symbol **(my call)**.
  - Budget 200M per team.
  - Minimum opening bid 1M, raises in 1M steps.
  - Each team buys exactly 12 players.
  - Unspent budget is worthless after the draft and does not carry into FAAB **(my call)**.
- **Maximum bid:** Remaining budget − 1M × (open roster spots − 1).
- **Nomination:** Rotates in an order randomized by the commissioner before the draft. Teams with full rosters are skipped. The nominator names a player and an opening bid of at least 1M.
- **Timers (commissioner-adjustable before and during the draft):**
  - Nomination timer, default 60 seconds. If it expires, the app auto-nominates the available player with the most fantasy points last season, at 1M **(my call)**.
  - Bid timer, default 15 seconds, reset to its full length after every bid **(my call)**.
  - When the bid timer expires, the player is sold to the highest bidder.
- **Server-authoritative:** The server owns the clock, bid order, and validation. Bids for a lot are processed one at a time in a transaction, so two simultaneous bids can never both win. Clients that drop and reconnect get the full current state.
- **Commissioner controls:** Pause and resume, change timers, undo the last sale, edit a completed sale (player, team, price), all logged.
- **Draft-prep info:** Player list with position, franchise, last season's fantasy points and positional rank, season projection (section 12.4), and links to each player's game log and history (section 12).
- **After the draft:** Rosters are set. Undrafted players go on waivers until the first daily run at least 12 hours after the draft ends **(my call)**.

---

## 9. Waivers and free agency

- **FAAB budget:** 100M per team for the season. Bids in 1M steps. 0M bids are allowed. Budget can never go negative. FAAB can be traded (section 10.1).
- **Daily run:** 03:00 America/New_York. No IPL match is in progress then.
- **Blind claims:** A manager submits claims (player, bid, optional player to drop). The drop must be unlocked when the run processes.
- **Processing order:** All claims are processed in descending bid order. Each is revalidated against current budget, roster size, and lock state. Losing or invalid claims fail with a stated reason.
- **Tied bids:** The team with the lower win percentage wins, then the lower PF. Before any results exist, ties use a random order fixed at draft time **(my call)**.
- **Dropped players:** They go on waivers until the first daily run at least 12 hours after the drop **(my call)**.
- **Free agents:** After a run, unclaimed players are free agents and can be added instantly, first come first served. A drop is required if the roster is full, and the dropped player must be unlocked. A free agent whose gameweek fixture has already started can be added but arrives locked on the bench (section 7.4).
- **Playoffs:** Waivers stay open for all teams during the playoffs **(my call)**.

---

## 10. Trades and gameweek lifecycle

### 10.1 Trades

- **Shape:** Any number of players on each side, plus optional FAAB in 1M steps from either side. One side may send only FAAB, for example a player for 15M FAAB. If a team would exceed 12 players, it must name drops (unlocked players) as part of the trade.
- **FAAB in trades:** The amount is checked against the sender's remaining FAAB when the trade is proposed and again at processing. A trade that would push either team below 0 fails. Trades process before waivers in the daily run, so a team that traded FAAB away has its pending waiver claims checked against the new balance. Claims it can no longer afford fail with that reason **(my call)**.
- **Flow:** Propose, then accept, reject, or cancel. A counter-offer is just a new proposal **(my call)**.
- **Processing:** An accepted trade processes in the 03:00 Eastern daily run, at the first run at least 12 hours after acceptance. Until then, the commissioner can veto it. For trades involving the commissioner's own team, the designated co-commissioner holds the veto.
- **Locked players:** If any player in the trade, or any named drop, is locked in a gameweek that hasn't closed, the whole trade waits for the first 03:00 run after that gameweek closes.
- **Revalidation at processing:** All players are still on the expected rosters and roster sizes are legal. Otherwise the trade fails with notice to both teams.
- **Deadline:** Trades must be accepted before the first fixture of GW9 starts. Trades accepted before the deadline still process afterward under the rules above.

### 10.2 Gameweek states

1. **Upcoming:** No fixture has started. Fixture-to-gameweek reassignment is allowed.
2. **Live:** The first fixture has started. Provisional points update during play.
3. **Awaiting close:** All fixtures are finished, postponed, or washed out. Points are still provisional, and source corrections are applied.
4. **Final:** The first 03:00 Eastern run after the last fixture finishes. Just before closing, the worker re-pulls every fixture in the gameweek from Sportmonks so late scorer corrections are included. It then freezes the points, settles matchups, and updates standings.
   - Locks for that gameweek are released.
   - Trades and drops waiting on those locks become eligible.
   - Scores change after this only if the commissioner explicitly reopens the gameweek. The reopen is logged and visible to everyone, and closing again re-settles the matchups.

**Order of the daily 03:00 run (my call):**

1. Close any gameweeks that are due, and settle matchups and standings.
2. Process trades.
3. Process waivers.

Closing first releases the locks that trades and drops were waiting on, so they process in the same run. Waiver tie-breaks use the standings just updated.

A trade can still wait more than one cycle only in one rare case: one of its players has already locked in the next gameweek before the previous one closed (a split double-header).

**Unresolved data flags at close (my call):** The gameweek closes on schedule anyway. This follows the rule that corrections are allowed until the gameweek ends.

- Any open flags (for example, a run-out with no credited fielder) stay visible on the affected matchup and the health page.
- From the evening before a scheduled close, the health page highlights open flags so the commissioner can fix them in time.
- A commissioner stat correction on a Final gameweek is one action: it reopens the gameweek, rescores, and re-settles, with a required reason, logged.

Gameweeks can overlap. When a double-header is split across two gameweeks, GW N+1 can go live before GW N is final. Locks and lineups are per gameweek, so this is safe.

---

## 11. Live scoring pipeline

- **Fixture sync:** The worker imports IPL 2027 fixtures and squads from Sportmonks daily, recording fixture IDs, scheduled starts, status, and postponements.
- **Polling:**
  - From 60 minutes before a fixture's scheduled start, poll for toss and lineups every 5 minutes.
  - While the fixture is live, poll every 30 seconds for the fixture with `batting`, `bowling`, `lineup`, `balls`, and `runs`.
  - After it finishes, poll every 10 minutes for 2 hours.
  - Do a final pull at gameweek close.
  - These intervals are the builder's call within the rate limit. About 120 calls per hour per live match is far below the limit.
- **Each poll:**
  1. Store the raw JSON response for audit and replay.
  2. Normalize it into player-match stat records, regulation and Super Over separately.
  3. Run the scoring engine.
  4. Store totals and breakdowns, marked provisional or final.
  5. Recompute affected matchup totals, projections, and win probabilities (section 12.4).
- **Clients:** Live pages (matchup, league scoreboard, player cards) poll the app's own API about every 60 seconds. There are no websockets for scores.
- **Recovery:** If the server or internet is down during a match, the worker re-pulls the affected fixtures when it recovers. All points are recomputed from source, so nothing is lost as long as recovery happens before the gameweek closes.
- **Record/replay harness:** The raw responses captured during the Big Bash trial, and any IPL history pulled, can be replayed in sequence to simulate a live match in tests and development.
- **Health:** A commissioner-only status page shows the last successful Sportmonks poll per fixture, the last daily run, and any data flags (missing fielder, unknown player, failed parse).

---

## 12. Past data, rankings, Sportmonks verification gates, projections

### 12.1 Past data

- **Seasons covered:** Every IPL season with available data (2008 onward), plus the current season as it is played. IPL only, no other competitions. All matches are scored under `t20-v0.7`.
- **Older seasons:** Their data may be thinner, for example missing fielder credits or no ball-by-ball detail for some deliveries. Gaps are flagged on the affected match and never guessed.
- **Player pages have two views, in the style of Sleeper's player cards:**
  - **Game log:** One row per IPL match, newest first, filterable by season.
    - Columns: date, season and match number, opponent, and fantasy points, followed by the key stats.
    - Batting stats: runs, balls, 4s, 6s, strike rate.
    - Bowling stats: overs, runs conceded, wickets, economy, dots, maidens.
    - Fielding stats: catches, stumpings, run-outs.
    - Tap a row to expand the full point breakdown, regulation and Super Over separately.
    - Current-season rows also show the gameweek and whether the match is live, provisional, or final **(my call)**.
  - **History:** One row per season, plus a career-total row.
    - Columns: matches, total fantasy points, points per match, best and worst match.
    - Also each season's batting, bowling, and fielding totals, and the player's positional rank that season (section 12.2).
- **Auction room:** The player list shows each player's season-history numbers. Tapping a player opens the same two views.
- **Source:** Sportmonks for every season the Major plan includes with full scorecards. For any IPL season it lacks, do a one-time import from Cricsheet, which has every IPL season since 2008, into the same normalized stat records. Cricsheet is not used for anything else.
- If Cricsheet is used, its run-out credit must follow the same convention Sportmonks uses for `runoutby`. Determine that convention in gate 1.

### 12.2 Positional rankings

- **Rankings page:**
  - **Filters:** position (WK, BAT, ALL, BWL, or all) and season (current by default, or any past IPL season).
  - **Columns:** rank, player, IPL franchise, fantasy owner (team name or "Free agent"), matches, total fantasy points, points per match.
  - **Ranking:** By total points by default, with points per match as an alternative sort. Points-per-match ranking needs at least 4 matches that season **(my call)**.
- **Where ranks appear:** The player page header shows the current rank (for example "BWL #3"), and each history row shows that season's rank. The free-agent list and the auction room show current and last-season positional rank **(my call)**.
- **Current season:** Ranks update as matches are scored. They include provisional points, labeled until the gameweek is final.
- **Positions for past seasons:** Each player is ranked under his current single position for every season **(my call)**. Sportmonks has no historical positions, and the league uses one position per player. Players with no known position (for example retired players found only in Cricsheet) are listed as "Unclassified" and left out of positional ranks.

### 12.3 Verification gates (Sportmonks trial during the Big Bash, December–January)

Each gate has a fallback if it fails. Run these before building on the assumption.

| # | Check | Fallback if it fails |
|---|---|---|
| 1 | `runoutby` identifies the credited fielder for every run-out, including which fielder is credited when two are involved. | Commissioner enters or confirms run-out credit per dismissal via the stat-correction tool. Flag every run-out missing a fielder. |
| 2 | Catches and run-outs by substitutes identify the substitute player. | Commissioner correction. Flag "sub" dismissals without a player. |
| 3 | Super Over innings are distinguishable from regulation innings (fixture `super_over` flag plus per-inning markers). | Derive from inning numbering. Commissioner override per fixture. |
| 4 | Ball-by-ball data supports per-delivery dots, maidens, wides, and no-balls, and reconciles with the bowling card. | Use bowling-card fields where present. Flag mismatches. |
| 5 | Lineups (playing XI and impact substitutes) are available around the toss. | Show XI only once the match starts. |
| 6 | Which past IPL seasons (2008–2026) the Major plan includes with full scorecards and ball-by-ball data. Record the list. | One-time Cricsheet import for every season it lacks (12.1). |
| 7 | Live latency and how post-match corrections show up in the data. | Adjust polling and the close-time re-pull. |
| 8 | Positions exist and look right for IPL 2027 squad players. Squads reflect the December auction and later replacements. | Commissioner sets or overrides positions, using franchise squad pages. Manual player adds. |

Record the findings in the repo as a short report. They may change details in sections 5, 11, and 12, but not the rules themselves.

### 12.4 Projections and win probability

Projections and win probability are advisory only. They never affect scoring, locks, or any league rule.

**Per-match projection**

A player's per-match projection = his recency-weighted average of IPL match fantasy points under `t20-v0.7`, shrunk toward his position's average when he has few matches, × his chance of playing.

- **Recency weighting and shrinkage:** The exact form (for example, exponential decay by match) and the strength of each are the builder's call, tuned by the backtest below.
- **Chance of playing:** The share of his franchise's recent matches in which he appeared, including as an impact substitute. Use the last 5 matches this season, falling back to the end of last season early on **(my call)**.
  - Once the playing XI is announced, it becomes 1 if he is in the XI and 0 if he is not.
  - A named impact substitute keeps his pre-toss value **(my call)**.
- **Players with no IPL history:** Position average × a default chance of playing set from the backtest **(my call)**.

**Derived projections**

- **Gameweek projection:** The sum of his per-match projections over his fixtures in that gameweek (0, 1, or 2).
- **Rest-of-season projection:** Per-match projection × his franchise's remaining league fixtures.
- **Range:** A typical low and high, from the recency-weighted 25th and 75th percentiles of his past match scores **(my call)**.
- **Refresh:** In the 03:00 run, when XIs are announced, and after each match.

**Where projections show**

- Lineup screen: each player and the team total for the gameweek.
- Matchup page: projected vs. actual.
- Free-agent list and rankings: rest of season.
- Auction room: season projection.

**Backtest gate**

Before shipping, project every IPL 2024–2026 match using only data from before that match. Compare mean absolute error against a plain season-to-date average (prior season early on). Ship only if the weighted model beats that baseline. Record the numbers in the repo.

**Win probability**

Shown on the matchup page before the gameweek, and updated as matches progress. It is calculated by Monte Carlo simulation, about 10,000 runs with a fixed seed so results are reproducible (run count is the builder's call).

- **Each simulated team total** = points already banked (final or provisional) + simulated points for each starter's remaining fixtures that gameweek.
- **A starter's simulated match score:** With probability (1 − chance of playing) he scores 0. Otherwise, draw a score from his own past IPL match scores under `t20-v0.7`, recency-weighted.
  - Players with fewer than 10 past matches draw from a blend of their own and their position's distribution **(my call)**.
- **A match in progress:** His current points + a simulated score scaled by the share of the match's balls still to be bowled **(my call)**.
- **Independence:** Players are treated as independent. This known simplification makes the probability slightly overconfident, because teammates' results move together.
- **Display:** Each team's win percentage. Simulated ties are counted but not shown separately **(my call)**.
- **Recompute:** Whenever a poll changes a matchup's banked points (at most once a minute per matchup), and in the 03:00 run.
- **Sanity tests:**
  - A matchup with no remaining fixtures is 100/0 for the leader.
  - Two identical lineups give about 50/50.
  - Results are identical for the same seed and inputs.

---

## 13. Commissioner tools

All actions are logged in the league activity log, visible to every manager.

- **League setup:** Invite manager emails, assign teams, name the co-commissioner, generate and publish the schedule, set the draft time, nomination order, and timers.
- **Player pool:** Override positions, add or deactivate players, link a manually added player to his Sportmonks record.
- **Fixtures:** Reassign a fixture to another gameweek (before that gameweek is live), mark or unmark a fixture as postponed, trigger a re-pull from Sportmonks.
- **Scoring:** View any breakdown and raw source. Enter a stat correction for a player-match, such as credit for a run-out or catch, or a corrected count. Corrections override the source for that field, are shown on the breakdown as a commissioner correction, and trigger a rescore.
- **Gameweeks:** Close early, or reopen a final gameweek with a stated reason.
- **Rosters:** Force add, drop, or move to resolve disputes.
- **Trades:** Veto (co-commissioner for the commissioner's own trades).
- **Auction:** Pause and resume, adjust timers, undo the last sale, edit a sale.

---

## 14. Architecture (Approach A)

- **Web app:** Next.js (App Router) with TypeScript. UI, server actions and API routes, Google sign-in through Auth.js limited to an email allowlist.
- **Realtime server:** A Node process with Socket.IO or `ws`, used only for the auction room. It owns auction state and timers. Each auction event is persisted to Postgres before it is broadcast.
- **Worker:** A Node process for scheduled and long-running jobs:
  - Sportmonks squad and fixture sync
  - pre-match, live, and post-match polling
  - the 03:00 Eastern daily run (gameweek close and settlement, then trades, then waivers, as in section 10.2)
- **Lock enforcement:** Checked at write time against fixture start and status. It does not depend on a job running on time.
- **Database:** Postgres 16.
- **Shared packages:**
  - `scoring` (pure, no I/O, `t20-v0.7` rules, versioned)
  - `rules` (lock checks, lineup validity, FAAB processing, trade validation, standings, playoff seeding)
  - `sportmonks` (API client plus normalizer to the stat model)
  - `projections` (pure: per-match, gameweek, and season projections, and the seeded win-probability simulation)
- **Deployment:** Docker Compose on Unraid with `web`, `realtime`, `worker`, `postgres`, and a Cloudflare Tunnel container. Nightly `pg_dump` to the array.
- **Points storage:** Store points exactly, as integer half-points or a fixed-precision decimal, never binary floats.
- **Rules versioning:** Every stored breakdown records the rules version it was computed with.
- **Testing:**
  - Golden scoring tests (5.9)
  - Rules-engine tests: locks, swaps, FAAB ordering and ties, trade processing and lock waits, standings and tiebreakers, playoff reseeding
  - Auction concurrency tests
  - Replay-harness tests of a full recorded match through the live pipeline
  - Projection backtest and win-probability sanity tests (12.4)

---

## 15. Milestones (suggested order)

| Milestone | Content | Target |
|---|---|---|
| M0 | Sportmonks trial during the Big Bash. Build the raw-response recorder and the full IPL history pull (2008–2026) first, before the trial starts if possible. Then: verification gates, record/replay harness, Sportmonks adapter, scoring engine with golden tests. | Mid-January |
| M1 | App skeleton and deployment (Docker, tunnel, Google sign-in), league and team setup, player pool and position sync, schedule generation, player pages (game log and history), positional rankings, projection engine with backtest | End of January |
| M2 | Auction room with season projections, and a dry-run draft among friends before the real one | Mid-February |
| M3 | Lineups and locks, live scoring, matchups, standings, gameweek lifecycle, gameweek projections, win probability | 1 March |
| M4 | FAAB and free agency, trades, commissioner tools, activity log, health page | 1 March |
| M5 | Playoffs and reseeding | Before GW12 (can follow the season start) |

---

## 16. Risks

- **Sportmonks data gaps** (fielder credits, substitutes, Super Overs): covered by verification gates and commissioner correction tools.
- **Sportmonks API version:** Cricket is on API v2, and Sportmonks' football docs mark v2 as deprecated. Keep all Sportmonks code inside the adapter package so a move to v3 touches one place.
- **Season start earlier than expected:** The milestones leave about two weeks of buffer. Playoffs can slip past the season start.
- **Self-hosting outages during matches:** Recovery by re-pull before close (section 11).
- **Schedule changes** (postponements, voided matches): fixture reassignment and postponement overrides (sections 6, 13).

---

## 17. Left to the builder

ORM and migration tool, UI component library and styling, exact screen layouts and navigation, monorepo tooling, job scheduling library, logging and metrics, how the realtime server and web app share auth sessions, the exact Sportmonks include sets and polling intervals within the stated bounds, and the normalized stat schema (it must support every field section 5 needs, with regulation and Super Over separated and missing values distinguishable from zero).

---

## 18. Decisions log

**Decided by the commissioner in this design session:** private friends league; self-hosted on Unraid; Google OAuth; Sportmonks as the sole live data source; live scores in v1; per-player lock lasting the rest of the gameweek; swaps only between unlocked players; points accumulate over all of a starter's gameweek matches; live auction draft room with commissioner-adjustable timers; 200M budget, 1M steps, 1M minimum; daily blind FAAB with 100M budget, 1M steps, 0 bids allowed; FAAB tradable; trades in v1 with commissioner veto; trade deadline before GW9's first fixture; trades process at the first 03:00 run at least 12 hours after acceptance, and wait for gameweek close when a locked player is involved; 8 starters (WK 1, BAT 2, ALL 1, BWL 2, FLEX 2) + 4 bench, no IR; positions from Sportmonks (official source fallback); ties recorded as ties; standings and playoff ties settled by PF; playoff reseeding; partial-play stats count; a match moved before its gameweek starts follows its new date, and a match not played as scheduled once its gameweek is live scores nothing; corrections allowed until the gameweek ends; domain already on Cloudflare; run-out points to the credited fielder only; wide and no-ball penalties per delivery; substitute fielders score catches and run-outs; no league chat; past data shown with v0.7 breakdowns in Sleeper-style game log and season history views, covering every available IPL season (IPL only); positional rankings; weighted-average projections and matchup win probability in v1; no payments; Approach A; agentic coding.

**Carried from the handoff (unchanged):** all point values and bands in section 5 other than the v0.7 changes; Super Over event-only treatment; 12 managers; 14 five-fixture gameweeks; 11-round round robin; six-team playoff with byes for the top two; WK eligible at BAT; no automatic bench replacement.

**Designer's calls:** marked **(my call)** throughout.
