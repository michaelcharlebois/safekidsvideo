# Sift on a Samsung TV (Tizen)

This folder is a "hosted web app": a Tizen shell that opens the live site. Once installed, the
TV app always shows whatever is deployed on Vercel — nothing to reinstall when the app changes.

## One-time setup (laptop)

1. Install **Tizen Studio** (https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html).
   In Package Manager, install **TV Extensions** (the "Samsung Certificate Extension" comes with it).
2. **Certificate**: Tools → Certificate Manager → New → *Samsung* → *TV* → sign in with your Samsung account.
   Create an author certificate and a distributor certificate. Add your TV's DUID when asked
   (shown on the TV under Developer Mode, step 3).
3. **Developer Mode on the TV**: Apps → press `1 2 3 4 5` on the remote → turn Developer mode **On**,
   enter your laptop's IP → reboot the TV.

## Install (every time you want to update the shell itself — rare)

```
sdb connect <tv-ip>:26101
cd tizen
tizen package -t wgt -s <your-certificate-profile> -- .
tizen install -n Sift.wgt -t <device-name-from "sdb devices">
```

Or in Tizen Studio: File → Import → Tizen project (this folder) → right-click → Run As → Tizen Web Application (pick the TV).

The app appears on the TV's home row as **Sift**. Pair it once from the parent dashboard (Devices → make a code; the TV opens on /pair the first time).

## Remote keys

Arrows move between tiles, Enter plays, Return goes home. The site handles these itself
(`src/app/watch/remote-nav.tsx`); inside a Tizen app they arrive as plain key events, unlike
in Samsung's browser where the arrows move the mouse pointer instead.
