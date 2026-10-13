# Brightframe design — Phase 3 (Kids and child settings), plus three corrections

The authorization rules are unchanged throughout.

## Corrections (commit `d7807aa`)

1. **One meaning of "the AI found X".**
   - Intensity decides: a concern is found at intensity 1–3, and can hold a video back at 2 or more.
   - `isFound`, `foundConcerns` and `BLOCKING_INTENSITY` live in `lib/gate.ts`. Review normalization derives `present` from intensity.
   - The gate, the explanations, the AI assessment panel, channel reports and the reviewer-learning job all use the same helper.
   - A contradictory answer can no longer hide a restriction (present: false, intensity 3) or invent one (present: true, intensity 0).
   - Tests: `test/findings-consistency.test.ts`, which renders the real `Assessment` component.
2. **Accurate explanations.**
   - `ruleHits()` returns the gate's reasons as data, and `lib/explain.ts` turns them into plain sentences:
     - "The AI review found monsters (moderate), which Leo's settings hold back."
     - "Other parents reported scary imagery… The AI review didn't flag it as moderate or strong."
     - "The AI review suggests ages 8 and up; Maya is 6."
     - "It's a gameplay commentary video, a kind Maya's settings hold back."
     - Low-confidence, incomplete, missing and sample reviews each get their own sentence.
   - Other parents' reports are never attributed to the AI. The Review label is now "Held back by settings".
3. **Evidence before the decision.**
   - Every Review card lists the relevant findings — concern, severity, timestamp link, source (AI review or other parents) — above the actions, on every screen size. The full assessment stays expandable.
   - On the video page, the "Passes the AI review vs Allowed by you" key is now behind "What's the difference?".

## Information architecture (proposed, then implemented)

The parent's question is "What can Maya watch, when, and how can she ask for something else?" Before this phase, the answer was spread across:
- **Kids** (`/parent/kids`): a list plus an edit form
- **Settings** (`/parent/settings?kid=`): one long form mixing per-child and family-wide settings
- **Devices** (`/parent/devices`)
- **Stats** (`/parent/stats`)

| Page | Route (unchanged) | What it is now |
|---|---|---|
| **Kids** | `/parent/kids` | Every child at a glance: four answers per child (what they can watch, when, how they ask for more, where they watch), each with a "Change" link into the child's page. Also **Add a child**, and a separate **Family settings** card ("These apply to every child") with the family PIN and the parent-report threshold. |
| **Child page** | `/parent/settings?kid=` | The same four answers at the top, then one section per decision. **Each section saves on its own.** |
| Devices | `/parent/devices` | Unchanged for now (Account phase). The child page links to it and can switch a screen between "the child's own" and shared. |
| Stats / insights / check-in | unchanged | Linked from the child page. |

Sections on the child page:

| Section | What's in it | Shown or folded away |
|---|---|---|
| Viewing mode | Three mode cards (Locked / Ask first / Open), each saying what the child can watch and how asking works | Cards shown; "made for kids" search and AI checks per day folded away |
| Content | Age (read-only here: edited in Profile, because it's part of the profile), concerns in three groups, formats, how per-video exceptions work | All shown |
| Screen time | Minutes per day, bedtime, today's usage, extra time today | Shown; skip limits folded away |
| Screens | This child's devices and shared screens, with "Make it [child]'s own" / "Make shared" | Shown |
| Home screen | Tuning the "For [child]" row (never changes what's allowed) | Folded away; channel order stays on Home |
| Profile | Name, age, picture, interests; two-step removal | Shown |

**Family-wide vs per-child.** Only two settings are family-wide in the data model: the PIN and `flagThreshold`. Both now live in the Family settings card on Kids and are labelled. Everything on a child's page is that child's own.

## Decisions beyond the specification

- **Sectioned saves.**
  - `lib/settings-form.ts` applies only the sections a form names, so saving screen time can't wipe content rules. A form without a section behaves as before.
  - Tests: `test/settings-form.test.ts`, plus two walkthrough checks.
  - Saves come back to the same section with a "saved" note.
- **Mode descriptions** come from one place (`lib/modes.ts`) and match the code:
  - Locked: no search and no asking.
  - Ask first: anything new from search goes to Review.
  - Open: search finds play once the AI review passes the child's settings.
  - The order is Locked, Ask first, Open, and the old label "Open, ask first" is now "Ask first".
- **Removing a child takes two steps** and says what is deleted. Previously it was one tap.
- **Age is edited in one place** (Profile) and shown read-only in Content, because saving the profile without an age clears it.
- **Interests** say they only affect ordering, never what's allowed.

## Screenshots (`phase3/`)

These are the real app in local mode with the UX fixture family. Thumbnails are placeholders. Devices are a Supabase feature, so in local mode the Screens section explains that and lists nothing.

Files:
- `kids-desktop`, `kids-mobile-1`
- `child-desktop` (full page), `child-mobile-1..3`
- `fix-review-mobile-evidence`, `fix-review-desktop`, `fix-video-mobile` (the corrections)
