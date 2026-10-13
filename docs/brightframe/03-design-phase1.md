# Brightframe design — Phase 1 (foundations, shell, parent dashboard)

Scope, per the Phase 1 brief:
- design tokens
- the B logo as real SVG artwork
- shared primitives
- the parent app shell
- the parent **Home** dashboard

Every other screen keeps its layout. Those screens pick up the new palette and font through the shared tokens, but they haven't been redesigned.

No product behaviour changed:
- Data fetching, routes, server actions and the gate are untouched.
- Every number on the dashboard is computed from `authorize()` for the selected child.

## Tokens (`src/app/globals.css`)

| token | hex | role | contrast |
|---|---|---|---|
| Forest | `#0F3D2E` | brand, primary buttons, headings | 11.6:1 on ivory |
| Apricot | `#FF9F6E` | warmth and "a child asked"; never text on light | forest text on apricot 6.0:1 |
| Apricot ink | `#A84A1A` | apricot-family text | 5.5:1 |
| Sage / sage-soft | `#B7C9B1` / `#E9F0E5` | selected nav, soft accents | — |
| Ivory | `#FFF9F1` | page | — |
| Sand / sand-soft | `#EADFCF` / `#F4EDE2` | borders, neutral fills | — |
| Ink | `#1E2B26` | body text | 14:1 |
| Muted | `#56655E` | secondary text | 5.9:1 |

**Status colours** are deliberately distinct, and every status also carries an icon and words, so none relies on colour alone:

| status | colour | meaning |
|---|---|---|
| Ready | green `#1B7A4B` | plays for this child |
| Being reviewed | slate `#4F5D72` | no usable AI review yet |
| Held back | amber `#9A5B00` | waiting on a parent |
| Blocked | red `#B3261E` | a parent blocked it |
| Allowed by you | forest on sage | explicit per-child approval |

Every text and background pair is at least 4.5:1 (WCAG AA).

The older token names (`bg`, `line`, `accent`, `sun`, `grass`…) are mapped onto the new palette, so pages that haven't been redesigned don't break.

**Type:** Plus Jakarta Sans, self-hosted from `@fontsource-variable`, so there's no Google Fonts call on parent pages.
- Scale is a major third from a 16px base: caption 13, body 16, title 25, display 39.
- Headings are 700–800 weight, forest, with tracking −0.02em.
- No serif yet. It's optional in the brief, and nothing in Phase 1 needed an editorial moment.

**Shape:**
- Controls are pills; cards use 18px corners; panels use 24px.
- Only one element per screen gets the raised shadow: the decision a parent needs to make.

**Focus:** a 2px forest ring with a 2px ivory gap, visible on every surface. It's scoped away from the kid screen, which keeps its large yellow D-pad focus. Reduced-motion preferences are respected.

## Logo (`scripts/brand/build-logo.mjs` → `public/brand/*.svg`, `src/components/logo.tsx`)

The B is built from geometry, not traced from the concept image:
- one straight stem
- a top bowl (circle r25) and a larger bottom bowl (circle r31), whose computed intersection forms the waist notch
- an apricot play triangle set flush into the stem

The wordmark is "Brightframe" in Plus Jakarta Sans ExtraBold, converted to outlines. The font's licence (OFL) permits that. Tracking is −0.025em, and the mark's height is 1.42× the cap height, sitting on the baseline.

Files:
- **horizontal logo:** colour, dark and mono
- **mark:** colour, dark and mono; the mono version cuts the triangle out
- **app icon:** 1024px master, plus 180, 192 and 512px PNGs and the favicon

React: `<Logo>`, `<BrandMark>`, `<AppIcon>`. The old `<Wordmark>` name still works and now renders the new logo.

See `phase1/logo-and-palette.png`.

## Primitives (`src/components/ui.tsx`, `icons.tsx`, `src/lib/status.ts`)

- **`Button` / `buttonClass`:** primary, secondary, warm, danger, quiet; sizes sm, md, lg.
- **`Card`:** a `raised` option for the one decision on a screen.
- **`StatusBadge`:** fed by `playStatus(v, settings)`, a thin wrapper over `authorize()`. A badge can therefore never claim more than the gate allows.
  - It keeps "a channel brings videos in" separate from "plays for this child".
  - It uses "Allowed by you", not "safe".
- **`Tag`:** neutral information such as "AI review: ages 2–7". It's worded as an assessment, not a guarantee.
- **Layout pieces:** `SectionHeader`, `EmptyState`, `Notice`, `Meter`.
- **Icons:** an icon set drawn on a 24px grid, replacing the emoji glyphs in navigation.

## Shell (`src/app/parent/layout.tsx`, `parent-nav.tsx`)

The shell has the same four real destinations at every width: Home, Review, Kids, Account.

| width | navigation | other parts |
|---|---|---|
| ≥ 1024px | left sidebar | children list with each child's open requests; "Add a child"; "Open the kid screen" |
| 768–1023px | top bar with the destinations | — |
| < 768px | compact top bar plus bottom tabs | — |

Switching child keeps you on any page that's about one child (Home, Review, Settings, Stats). Anywhere else it goes to Home.

Library, Activity and similar entries in the mockups aren't routes in the app, so they weren't added.

## Dashboard (`src/app/parent/page.tsx`)

Top to bottom:
1. **Child header:** avatar, name, and the child's setup in a sentence, with a link to change it.
2. **Four counts**, each a link to its matching list: Ready to watch; Being reviewed; Needs your decision; Minutes today against the limit.
3. **Needs your decision** (raised):
   - the child's requests, with what the gate says and Allow / Not now / See the full review
   - then a summary row for reviewed videos held back by filters
   - an "all clear" line when there's nothing
4. **On [child]'s screen:** a forest-dark miniature of the real kid shelves. This is the page's one bold element.
5. **Channels:**
   - per-child order, with up/down controls
   - status badges per channel
   - filter chips (Ready / Being reviewed / Held back) and a video search
6. **Side column:**
   - **Today:** minutes and recently watched
   - **Library:** what the library means for this child
   - **Add a channel:** YouTube search, pasted link, starter packs
   - **Reviewed for other families**

Loading (`loading.tsx`, a skeleton), error (`error.tsx`, with retry) and empty states (no child, no channels, no matches, nothing on screen yet) are all included.

## TV / kid screen

It isn't redesigned in Phase 1. It keeps its remote-first theme, D-pad focus handling and fonts, and only its logo changed. Reference 05 sets the direction for its own phase:
- a dark forest ground
- large type
- focus-first rows driven by the existing `RemoteNav`

Phone and tablet kid layouts will be touch-first, separate from TV.

## Screenshots

`phase1/`:
- desktop, tablet and phone dashboard
- keyboard focus
- logo and palette sheet

These show the **real rendered app** in local mode with a UX fixture family (`scripts/e2e/ux-fixture-db.json`: two children, five channels, twelve videos).

Thumbnails are flat placeholders. The sandbox can't reach YouTube's image server, so the screenshot script substitutes them; production shows real thumbnails.

Kid requests and watch time are Supabase-only. In local mode, the request card and minutes-today show their empty states, so the request card should be reviewed in the staging/demo environment.

## Not yet done (next phases)

- Review queue and video page in the new layout. Reference 04 is the target.
- Kids & settings, account and library pages.
- The TV / kid screen.
- Replacing emoji child avatars, if wanted.
