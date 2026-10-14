# Targeted fixes before staging: checkpoint

Branch `feature/brightframe`. Production untouched: no merge, migration, deploy or domain.

## Commits
| Commit | Fix |
|---|---|
| `5094030` | Ask First / Open: asking a grown-up isn't limited by the AI-review allowance |
| `9193b74` | More time: stored, child-scoped requests (0022) answered in Review; bedtime offers no extra minutes |
| `2072923` | TV: focused primary buttons legible; a keyboard's Backspace edits the search keyboard and PIN pad |
| `1c89aa4` | Player: finished / skipped follows the skip budget's verdict |
| `ab826a1` | Production-sized migration rehearsal; 0018 lookup indexes; staging-readiness plan |

**Awaiting approval:** the one-night bedtime extension. Its semantics are in `13-bedtime-extension-proposal.md`; nothing is implemented.

## Tests
| Suite | Result |
|---|---|
| `tsc`, `eslint .`, `next build` | Clean |
| Vitest | 332 passed, 15 skipped (the real-Postgres ones; they run in the staging script) |
| `staging-db-check.sh --scale` | Passed at 2,000, 8,000 and 20,000 families (timings in `14-staging-readiness.md`) |
| Gating walkthrough | 40 / 40 |
| `kid-home.sh` | All passing |
| `kid-search.cjs` | 38 / 38 |
| `kid-search-askfirst.cjs` | 6 / 6 |
| `kid-player.cjs` | 35 / 35 |
| `kid-who.cjs` | 17 / 17 |
| `kid-timeup.cjs` | 7 / 7 |
| `kid-moretime.cjs` (approve) | 12 / 12 |
| `kid-moretime.cjs` (decline) | 12 / 12 |

**New regression coverage:**
- **Allowance:** `check-plan.test.ts` covers Ask first with the allowance exhausted, Open with it exhausted, reviewed videos using no allowance, and "nothing but authorize() plays".
- **0022:**
  - `time-requests-db.test.ts`: one pending per child per day across screens, children separate, the family foreign key, grant/status constraints, rollback.
  - `time-requests.test.ts`: states, expiry, the inbox.
- **More-time walkthrough** (`kid-moretime.cjs`): two screens for one child, no push subscription (local mode has none), yesterday's ask expired, approve +15 (the child's screen recovers by itself), a stale double answer adding nothing, decline.
- **Outcomes:** `skip-ledger.test.ts` checks that the recorded outcome never says finished when the budget says skip.
- **Focus and keys:**
  - The walkthroughs assert the focused colours and contrast of Time up's Ask, the PIN pad's OK and the search Search key.
  - Physical Backspace on the search keyboard (focus on a key) and on the PIN pad deletes a character.
  - The Samsung Return key still goes back.

## Screenshots (`phase8/`)
- **Focused TV buttons:** `timeup-limit-tv-focused`, `who-tv-pin-ok-focused`, `search-tv-search-key-focused`.
- **More time:** `timeup-limit-tv-sent`, `timeup-limit-tablet`, `timeup-limit-tablet-waiting`, `timeup-limit-tv-declined`, `timeup-limit-tv-approved-home` (10 min left after +15), `parent-review-more-time`.
- **Bedtime, no ask:** `timeup-tv`, `timeup-tablet`, `timeup-phone`.

## Remaining blockers before release
1. **Your decision** on the bedtime extension: semantics and the four questions in doc 13.
2. **Real production dump rehearsal** (step 1.2 of doc 14). Synthetic data can't show real skew.
3. **Supabase staging and isolated preview** (doc 14, steps 2–7). Not verified there yet:
   - the 0019 lockout
   - personal-device switching
   - real push, including more-time pushes with real subscriptions
   - `watched_sec` and beacon rows
   - 0020–0022 behaviour
   - real YouTube search, review and playback
4. **Physical Samsung TV** (doc 14, step 8): the remote, media keys, autoplay, the app-exit beacon, 10-foot legibility.
5. **Security checklist** (doc 14, step 9). In particular, rotate any key that was ever pasted outside environment settings.

## Notes
- **Bedtime:** the screen no longer offers extra minutes, because they never lifted bedtime. A parent can still change the bedtime itself in Settings.
- **The 25-request cap** per child is a sanity limit on unanswered asks, not a review quota. It's easy to change (`MAX_PENDING_REQUESTS_PER_CHILD`).
- **Open mode with the allowance used up** now sends the ask to a grown-up instead of saying "No more checks today".
- **Back keys:** some non-Samsung TV engines may report their Back key as Backspace. On the search keyboard and PIN pad that would delete a character instead of going back. Escape and the Samsung/LG codes are unaffected. Worth checking on any other TV platform before supporting it.
- **Local mode** now records viewing sessions, so limits and Activity work offline. Supabase behaviour is unchanged.
