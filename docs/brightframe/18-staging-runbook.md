# Staging runbook: isolated Supabase project and protected Vercel preview

Everything here is staging. Nothing touches production: no merge, no production migration, no production deploy, no brightframekids.com, no production traffic. Synthetic data only. A production data dump needs your separate approval.

Steps marked **You** need your Supabase or Vercel account. I don't have access to either, and secrets never go through chat or git.

## 0. Before anything: previews of this branch are already being built (You)

GitHub shows that every push to `feature/brightframe` triggers a **preview deployment in the `shiftkids` Vercel project**. The latest was for this branch's current commit, at 05:27 UTC today.

Those previews run with `shiftkids`' **Preview-scoped** environment variables. If any production value is scoped to Preview, then each preview build of this branch runs against production:
- Supabase URL and keys
- Stripe keys
- VAPID keys
- `CRON_SECRET`

The new code against production's old schema mostly fails (it reads columns that don't exist yet). It is still not isolated, and some writes could succeed, such as time zone, push subscription or checkout.

In `shiftkids` → Settings:
1. **Environment Variables:** check every production secret's scopes. Each should be **Production only**, not "Preview" or "All environments".
2. **Git → Ignored Build Step:** add a command so this project stops building the branch. Vercel skips the build when the command exits 0, and builds it when it exits 1:
   ```sh
   if [ "$VERCEL_GIT_COMMIT_REF" = "feature/brightframe" ]; then exit 0; else exit 1; fi
   ```
3. **Deployments:** filter by branch `feature/brightframe` and delete those preview deployments. Don't open them.
4. **Deployment Protection:** confirm previews are protected (Standard Protection or Vercel Authentication), so nobody outside your team could have opened them.

If production values were scoped to Preview, tell me. We'll check the production database for anything those previews might have written. It would be little or nothing, but worth confirming.

## 1. Supabase staging project (You)

1. **Create the project.** Supabase → New project → **`brightframe-staging`**.
   - Use the same region and Postgres major version as production.
   - Use a new database password, kept in your password manager.
   - Don't use branching from production: a separate project shares nothing.
2. **Set up Authentication** (Authentication → URL Configuration):
   - **Site URL:** the staging preview URL from step 2.6. Fill it in after the first deploy.
   - **Redirect URLs:** `https://<staging-vercel-project>-*.vercel.app/**`
3. **Create test sign-ins** (Authentication → Users → Add user → Create new user, with **Auto Confirm User**). Make three, using plus-addresses of your own email so every message comes to you:
   - `…+bfstaging2@gmail.com`: owner of the two-child family
   - `…+bfstaging1@gmail.com`: owner of the one-child family
   - `…+bfstaging3@gmail.com`: owner of the three-child family

   Copy each user's **UID**. No other accounts should exist. The isolation check fails if any sign-in doesn't contain `+bfstaging`.
4. **Get the connection string:** Project Settings → Database → Connection string → **Session pooler** (port 5432). Keep it in your shell only:
   ```sh
   export STAGING_DB_URL='postgresql://postgres.<staging-ref>:<password>@<pooler-host>:5432/postgres'
   export PROD_SUPABASE_URL='https://<prod-ref>.supabase.co'   # public; lets the script refuse production
   ```
5. **Build the schema, seed it and migrate it**, from a checkout of `feature/brightframe` on your computer (needs `psql` 15+). `scripts/staging/apply.sh` refuses to run if the URL contains the production ref, if the project isn't empty, or if a step is out of order:
   ```sh
   scripts/staging/apply.sh schema                          # 0001 → 0017 (the shape production has today)
   scripts/staging/apply.sh seed <uid2> <uid1> <uid3>       # synthetic families, pre-release-shaped permissions
   scripts/staging/apply.sh preflight                       # every "must be 0" row is 0
   ```
   **Stop here** if you want the old-build rehearsal (section 5) to begin before migration: it starts on this schema. Otherwise continue:
   ```sh
   scripts/staging/apply.sh migrate                         # 0018 → 0023, timed, then the attribution report
   ```

**The seed** (`scripts/staging/seed-synthetic.sql`) contains:
- **Two-child family:** Maya 6 (Open) and Leo 4 (Locked).
  - An old approval Maya asked for.
  - An old approval with no child recorded (held after 0018, granting nobody).
  - One you'll dismiss after release.
  - A family-wide block, and a family-wide Keep hidden inside an approved channel.
  - Two approved channels.
- **One-child family:** Solo, with an old approval.
- **Three-child family:** Ava, Ben and Cy, with Ava's old approval, a family-wide library video, and a passed kid check for Ben.
- Some viewing history.
- No push subscriptions, no billing customers.
- Kid-screen PIN `2580`.
- Synthetic video ids. Real YouTube is tested by adding real channels in the app.

## 2. Vercel staging project (You)

A **separate Vercel project** is the simplest guarantee of isolation. It can't inherit production's environment variables, domains, crons or webhooks.

1. **Create it.** Vercel → Add New → Project → import `michaelcharlebois/safekidsvideo` as **`brightframe-staging`**.
2. **Settings → Git → Production Branch:** set it to a branch that will never exist, such as `staging-no-production`. Every deployment is then a **Preview**, and Vercel runs crons only for production deployments, so **no cron ever runs on staging**.
3. **Settings → Git → Ignored Build Step:** build only this branch and the old-build branch (section 5):
   ```sh
   if [ "$VERCEL_GIT_COMMIT_REF" = "feature/brightframe" ] || [ "$VERCEL_GIT_COMMIT_REF" = "staging/old-build" ]; then exit 1; else exit 0; fi
   ```
4. **Settings → Environment Variables:** set the variables in `.env.staging.example`, scoped to **Preview** only.
   - Every value is staging's: the staging Supabase URL and keys, and a **new** VAPID pair (`npx web-push generate-vapid-keys`).
   - Add a new `CRON_SECRET` (`openssl rand -hex 32`) and low AI budgets.
   - Use separate Gemini and YouTube keys if you can.
   - Leave Stripe blank (or test-mode only), and leave `DEMO_*` blank.
5. **Settings → Deployment Protection:** set **Vercel Authentication** for all deployments. Don't add a domain.
6. **Deploy:** Deployments → Create Deployment → branch `feature/brightframe`. Put the deployment's branch URL into Supabase's Site URL (step 1.2).
7. **TV wrapper:** for the Samsung TV, create a **Protection Bypass for Automation** secret (Deployment Protection). Point the Tizen wrapper at the preview URL with `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`. Keep the secret out of git.

## 3. Isolation check (You, on your computer)

Copy `.env.staging.example` to `.env.staging` (git-ignored) with the same values as Vercel, then:
```sh
PROD_SUPABASE_URL=https://<prod-ref>.supabase.co PROD_VAPID_PUBLIC_KEY=<production's public VAPID key> \
STAGING_EMAIL_PATTERN='\+bfstaging@' node scripts/staging/isolation-check.mjs .env.staging
```
It prints PASS/FAIL per check and never prints a value. Both inputs are public values. It confirms:
- **Supabase:** the URL isn't production's, and the staging keys work on staging and **are refused by production**.
- **Push:** staging has its own VAPID pair, and there are no push subscriptions yet.
- **Billing:** no live Stripe keys, and no billing customers.
- **Data:** every sign-in is a `+bfstaging` address, so the data is synthetic.
- **Jobs and spend:** `CRON_SECRET` is set, AI budgets are low, demo access is off, and the test-only switches are unset.

Also confirm in Vercel:
- `brightframe-staging` → Settings → Cron Jobs shows the jobs but "only run in production", and there are no production deployments.
- Supabase staging → Logs show only staging traffic while you test.

## 4. The staging checklist (You, with me reading results)

Work through `14-staging-readiness.md` sections 2–9 on the preview, signed in as the test parents:
- child authorization
- RLS: one test family can't read another's rows (use two browsers)
- PIN lockout from two screens at once
- requests, bedtime asks and extensions, and daily minutes
- **real YouTube:** search, review and playback, with a real channel added in the app
- watch-session accounting and the close-time beacon
- push to your own phone, which is the only push subscription that should exist
- the physical TV

Send me the results (screenshots, or `apply.sh status` output) and I'll check them against the expected behaviour. A non-production data dump is not needed for any of this.

## 5. Rollback rehearsal, with both builds (You deploy; I prepare)

**The old build** is whatever production runs today.
- Tell me its commit: Vercel → `shiftkids` → the current Production deployment → commit. Local `main` is `344521f`; please confirm it matches.
- I'll then push a `staging/old-build` branch at that commit. It's a new branch, with no merge and no change to `main`.
- `brightframe-staging` builds that branch as a second preview with the same staging variables. The old build reads the same variable names.

**A. Before migration (old build, old schema).** Do this if you stopped before `migrate` in step 1.5.
1. Open the old-build preview and sign in as `+bfstaging2`.
2. Pair a kid screen, approve a request, block a video and add a channel.
3. This is how real pre-release permissions get made.

**B. Migrate.**
1. Delete or stop using the old-build preview: the old build must never run against the new schema.
2. Run `scripts/staging/apply.sh migrate` and read the report.

**C. New build, after migration.** On the `feature/brightframe` preview, make the post-release changes the rehearsal covers:
- Maya's held approval: allow it for Maya only.
- Dismiss the other held approval.
- Never for Leo on a video in an approved channel.
- Keep hidden for Maya.
- Remove a channel.
- Allow a video for both children, then remove it from Leo.
- Add a library video for Leo only.
- In the three-child family, allow a video for Ava and Ben but not Cy.
- Have both children request the same video.
- Give Maya a bedtime extension tonight.

**D. Pause, roll back, switch builds** (the production procedure, `14` section 10, done on staging):
1. In `brightframe-staging`, set `BF_PERMISSION_WRITES_PAUSED=1` (Preview) and redeploy `feature/brightframe`.
2. Check that:
   - approving, changing a mode, filter, minutes, bedtime or PIN, adding a child, assigning a screen, and granting or cancelling a bedtime extension are all **refused**
   - kids can still watch
   - parents see the banner
3. Run `scripts/staging/apply.sh snapshot` to record every child's effective permissions.
4. Run `scripts/staging/apply.sh rollback`, typing the staging ref. The new build should now fail closed: nothing plays.
5. Redeploy the old-build preview, then remove `BF_PERMISSION_WRITES_PAUSED`.
6. Run `scripts/staging/apply.sh check`. It **fails if any child gained access** and lists what was dropped, which should match `rollback_0018_report` and `rollback_0021_report`.
7. On the old build, signed in as each test parent, confirm:
   - Leo can't play Maya's per-child approval
   - Cy can't play Ava and Ben's
   - the blocks and Keep hidden from step C apply to everyone
   - a sign-in, a pairing and a play all work

**E. Roll forward again.**
1. Stop using the old-build preview and delete it. The old build doesn't read the pause switch, so removing it is the only way to keep it off the new schema.
2. Run `scripts/staging/apply.sh migrate`, then redeploy `feature/brightframe`.
3. This shows that a rollback can be undone with the same migrations.

Locally I rehearsed every database step of A–E on a throwaway Postgres 16 with the seed:
- schema, seed, preflight and migrate (0018 → 0023, 40–100 ms each)
- snapshot, rollback and check: no child gained access; seven pairs were narrowed and reported; a deliberately added widening row made the check fail
- migrating again after the rollback
- the refusals: a production ref in the URL, a non-empty project, steps out of order, and a mistyped ref

Not yet rehearsed: either build running against a real Supabase project.

## What I need from you, in order
1. Section 0: the `shiftkids` preview builds of this branch. Check the variable scopes, stop the builds, delete those deployments, and tell me whether production values were scoped to Preview.
2. Section 1: create `brightframe-staging`, the three `+bfstaging` sign-ins and their UIDs, then run `apply.sh` (`schema`, `seed`, `preflight`).
3. Tell me production's current commit, so I can push `staging/old-build`.
4. Section 2: create the `brightframe-staging` Vercel project with Preview-only variables, protection, and no domain.
5. Section 3: run the isolation check and send me its PASS/FAIL output (it contains no secrets).
6. Sections 4–5, with me checking results as you go.
