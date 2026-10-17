# Samsung S85D hardware pilot: findings and open items

Target: Samsung QN65S85DAEXZA (S85D OLED, 2024), Tizen 8.0 / Chromium 108 at launch. Firmware can raise both, which only helps. Install and test steps are in `tizen/README.md`.

## Audit of the old `tizen/` project
- **Old names:** `Sift` names and ids (`SiftKidsTV.Sift`, `http://siftkids.com/tv`), the old icon, and a launch URL of `https://shiftkids.vercel.app/watch`, a non-staging deployment.
- **Inline script blocked:** an inline `<script>`, which a Tizen app's default content security policy blocks. The old shell may never have run its key registration or offline check.
- **No navigation rule:** no `tizen:allow-navigation`, so the hand-over to the site wasn't explicitly allowed or restricted.
- **Missing keys:** number keys weren't registered (Samsung only delivers them once registered), so they couldn't be used for the PIN pad or pairing code.
- **No diagnostics:** no reachability check, no clock check, and no diagnostics.
- **Replaced by** `tizen/app/` and `tizen/build-and-install.ps1`.
  - **Identifiers:** package `BrFrameDv1`, app `BrFrameDv1.Brightframe`, name "Brightframe Dev".
  - **Platform:** `required_version` 6.0, profile `tv-samsung`, Tizen Studio platform `tv-samsung-8.0`.

## The TV's web engine (tested on a real Chromium 108 with the Tizen 8 user agent)
- **Tool:** `scripts/e2e/tv-engine.sh` (Chromium 108 from npm `@sparticuz/chromium@108`, driven by puppeteer-core 19).
- **What works:** the kid experience runs on Chromium 108 with no script errors.
  - Next.js 16 hydrates, and the remote arrows move focus.
  - PIN pad, Home, Search, Samsung Return (10009), player, pause/resume and Time to rest all work.
  - Parent pages work too.
- **Found and fixed: missing player scrims.** Tailwind 4 writes gradient directions as `to bottom in oklab`. Colour-space interpolation arrived in Chromium 111, so on 108 the whole `background-image` was dropped. That removed the player's dark scrims behind white text. An `@supports not` fallback in `globals.css` fixes it; modern engines are unchanged.
- **Checked and fine:**
  - `color-mix()` and `lab()` have fallbacks, and there's no `oklch()`.
  - `1lh` only appears in the reset for date inputs.
- **Found and fixed: version detection.** Samsung's user agent has **no `Chrome/`** (`… 108.0.5359.1/8.0 TV Safari/537.36`). The diagnostics now parse that form. App code doesn't detect browser versions; TV detection uses `Tizen`/`SMART-TV`.

## YouTube embedded playback
Rules from [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality):
- no overlays, frames or other visual elements in front of any part of the player
- a viewport of at least 200×200
- autoplay only when more than half the player is visible
- no changes to the player beyond the API documentation

Hiding YouTube's controls (`controls: 0`) and driving playback through the API are documented, so both are fine.

**Before:** the player drew its title, controls, progress bar, the bedtime heads-up, flash icons and a "press OK" hint over the video, and a transparent tap-catcher covered it.

**Now, on TV:**
- Nothing is drawn over the player.
- With controls or a notice showing, the player shrinks into the middle band and the title and controls sit in bands above and below. Otherwise it fills the screen, with the bands hidden beneath it.
- No tap-catcher; the remote's keys are handled for the whole page.
- The iframe is kept out of the focus order.
- `scripts/e2e/tv-engine.cjs` checks geometrically that nothing that paints overlaps the player, banded and full screen. A planted overlay proves the check catches one.

**Still overlaid: the phone and tablet player**, which isn't the pilot device. It needs the same treatment before wider use.

**Found and fixed:**
- **Undersized player.** The player gave no width or height, so the real API's iframe would default to 640×390 instead of filling the screen. The scripted test player didn't show this. It's now `100%` in a positioned stage.
- **Black screen on errors.** There was no `onError`, so an unembeddable, removed or failed video left a black screen. Now there's a calm message, the next video plays after 6 seconds, and the error is logged.

Autoplay with sound may be blocked on the TV. The player already shows "Press OK to play" after 2.5 seconds; that's an item for the hardware check.

## Diagnostics
| Situation | What's there |
|---|---|
| Before the site opens | The shell's "Can't reach Brightframe" screen, with cause, site, model and firmware, engine, attempts, retry and exit |
| In the app | Press 0 ×3 for the grown-up panel: versions, online state, clock offset from the server, last keys, last problems |
| Server side | `[tv-diag]` lines in the staging logs from `/api/tv/diag` (same origin, truncated, never stored) |

Also:
- an error screen for the kid area (`watch/error.tsx`)
- an offline note
- pairing failures are logged
- **Fixed:** typing a code with several 0s no longer triggers the 0-key reload.

## Security and gating
- **Server-side controls are unchanged.** Pairing, revocation, child assignment, the shared-screen PIN, review gating, bedtime and limits are untouched. The TV is just another paired screen, with the session-isolation rules from `19`.
- **Navigation is pinned** to the staging host.
- **The Vercel bypass secret stays out of git**, though it is inside the `.wgt`; see the README.
- **`/api/tv/ping`** returns only the server time and build.
- **`/api/tv/diag`** accepts same-origin reports, from paired screens and parents. Unpaired screens may report only pairing and network problems.

## Can't be verified without the physical TV
1. Signing, install and launch with your certificate profile. Packaging and installation were checked here only against stand-in `tizen` and `sdb` tools.
2. Whether `tizen:allow-navigation` and `tv-samsung` behave as expected on this firmware, with no CSP or navigation blocking of the hosted site.
3. Whether keys registered in the shell keep arriving after the hand-over to the site: number keys and media keys.
4. That the screen cookie persists across app restarts and TV reboots.
5. Real YouTube on the TV:
   - audio
   - autoplay (or "Press OK")
   - pause and resume
   - seek
   - completion and auto-advance
   - the video filling the screen
   - the banded layout during playback
   - any YouTube element (watermark, end screen) behaving acceptably with `controls: 0`
6. Bedtime stopping playback after the TV sleeps and wakes, the 60-second server check, and disconnecting from the phone.
7. 10-foot legibility on the OLED, and burn-in exposure of static bands during long pauses.
