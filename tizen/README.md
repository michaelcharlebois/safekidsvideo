# Brightframe on the Samsung TV (development pilot)

The Samsung QN65S85DAEXZA (S85D, 2024, Tizen 8.0 / Chromium 108 at launch) gets a small **hosted app**:

1. A local page in the package registers the remote's keys.
2. It checks the **staging** site answers.
3. It opens the site's kid screen as the top-level page.

**Updates:** the site updates with every staging deployment; the TV app only needs reinstalling when files in `tizen/app/` change.

**Supervised home pilot only.** This isn't a store build, and it never points at production. Every parental control is the site's, enforced on the server:
- pairing and disconnecting screens
- child assignment and the shared-screen PIN
- review gating
- bedtime and daily limits

**What the app is allowed to do:**
- It can only ever navigate to the staging host (`tizen:allow-navigation`). It can't wander off to YouTube or a browser.
- The YouTube player runs inside the site, in an iframe.

## 1. A stable staging address (once, in Vercel)
Pairing lives in a cookie for one host, and each preview deployment gets a new URL. So give the staging branch a fixed address:

1. **Add the domain:** Vercel → **brightframe-staging** project → Settings → **Domains** → Add `brightframe-tv-staging.vercel.app`. If that name is taken, pick another `*.vercel.app` name and pass it as `-Site` below.
2. **Connect it to the branch:** "Connect to an environment" → **Preview**, Git branch **`feature/brightframe`**. The address then always serves the latest deployment of that branch.
3. **Never production:** don't use `brightframekids.com` or any production deployment. The build script refuses those.

**Deployment Protection:** the TV can't sign in to Vercel.
1. In **Settings → Deployment Protection → Protection Bypass for Automation**, create a secret.
2. Pass it to the build as `-Bypass` (or set `$env:BF_TV_BYPASS`).
3. The shell adds it when it opens the site, and Vercel then sets a cookie for that host.
4. The secret ends up inside the `.wgt`. **Don't share the package or commit it.** Revoke and replace the secret after the pilot.

Nothing changes in Supabase: the TV uses only the screen cookie set by pairing.

## 2. Build, sign, install (Windows; Tizen Studio and Developer Mode are already set up)
In PowerShell, from this folder of a checkout of `feature/brightframe`:

```powershell
.\build-and-install.ps1 -Site https://brightframe-tv-staging.vercel.app `
  -CertProfile <your Samsung certificate profile> -TvIp <TV IP address> -Bypass <bypass secret>
```

The script:
1. **Checks the site:** `https://`, and not production.
2. **Generates `tizen\build\Brightframe`:** the staging host goes into `config.xml`, and the site and secret into `shell-config.js`.
3. **Signs:** `tizen package -t wgt -s <profile>`, using your Samsung author and distributor certificates (the distributor certificate carries this TV's DUID).
4. **Installs:** `sdb connect <ip>:26101`, then `tizen install`.
5. **Starts:** "Brightframe Dev" on the TV.

**Notes:**
- **Script errors:** if PowerShell refuses to run the script, run `powershell -ExecutionPolicy Bypass -File .\build-and-install.ps1 …`.
- **Tizen Studio location:** if it isn't in `C:\tizen-studio`, add `-TizenStudio <path>`.
- **Using the Tizen Studio interface instead:** run with `-BuildOnly`, then in **Device Manager** right-click the TV → **Install app** → pick `tizen\build\Brightframe\Brightframe Dev.wgt`.
- **Install refused because of a different certificate:** uninstall the old app on the TV first (Apps → hold OK on it → Delete), or run `tizen uninstall -p BrFrameDv1.Brightframe -t <device>`. Uninstalling clears the pairing.

**Pairing:**
1. **On the TV:** the first launch shows Brightframe's **Connect this device** screen.
2. **On your phone:** go to Screens → **Make a code**.
3. **Back on the TV:** type the code with the remote's number keys.
4. **Optionally:** on Screens, set whose screen it is (one child's own, or shared with the family PIN).

## 3. Remote control
| Key | What it does |
|---|---|
| Arrows, OK | Move between tiles and buttons, and choose |
| Return | Go back (player → Home or Search) |
| Number keys | PIN pad and pairing code |
| Play/Pause, Play, Pause, ⏩, ⏪ | Playback (registered by the shell) |
| Home | Leave the app (the TV's own key) |

On the site's first screen, Return doesn't close the app: the hosted site can't call the TV's exit function. Use Home.

## 4. When something goes wrong
- **Before the site opens:**
  - **What you'll see:** the app shows **Can't reach Brightframe** with what happened (offline, timeout, HTTP status, protected site without the secret), the site, TV model and firmware, engine version, and the number of attempts.
  - **What to do:** it retries every 15 seconds; **OK** retries now and **Return** closes the app.
  - **Wrong clock:** a TV clock that's off by several minutes gets a note for a grown-up.
- **In the app:** press **0 three times** quickly for the grown-up panel. It shows:
  - build, Tizen and Chromium version, screen size
  - online or offline, and the TV's clock compared with the server's
  - the last keys pressed
  - the last problems: script errors, YouTube player errors with their meaning, pairing failures, going offline
- **Five 0s** reloads the page. That's ignored while typing a code.
- **Server side:** the same problems are logged in the staging project's Vercel logs as `[tv-diag]` lines, with the screen's name.
- **A video that can't play:** removed, private, not embeddable, or a player failure. The child sees "This video can't play right now", and it moves to the next video after a few seconds.
- **No internet:** the kid screens show a calm "No internet right now" note.

## 5. Hardware test checklist (supervised, about 30 minutes)
1. **Launch:** first launch → Connect this device. Pair with a code from your phone. The TV opens Who's watching (shared) or the child's Home (assigned).
2. **Restart:** quit with Home, relaunch: still paired. Restart the TV: still paired.
3. **Remote:** arrows and OK on Home, Search and the PIN pad; number keys on the PIN pad; Return from the player and from Search.
4. **Real YouTube:** a reviewed video plays **with sound**.
   - Does it autoplay, or show "Press OK to play"?
   - OK pauses and resumes; ⏩/⏪ and the remote's Play/Pause keys work.
   - Next works. A short video finishing moves on by itself.
5. **Nothing over the video:** while it plays, the video fills the screen with nothing on top. With controls up, the video shrinks and the title and controls sit above and below it, never on it.
6. **Video size:** the video fills the screen. It must not be a small box in a corner.
7. **Bedtime:** set bedtime a few minutes ahead in Settings. The heads-up appears above the video (not over it), and playback stops at bedtime, also after the TV sleeps past it. Extensions still work.
8. **Disconnect:** disconnect the screen on your phone. The TV stops at its next check and returns to Connect this device.
9. **Diagnostics:** press 0 three times. The panel shows Tizen and Chromium versions and "no problems recorded". Unplug the network: the offline note appears, and the shell's "Can't reach" screen shows on relaunch.
10. **Firmware:** note the version (Settings → Support → About This TV) and the panel's engine version. Report both if anything differs.
