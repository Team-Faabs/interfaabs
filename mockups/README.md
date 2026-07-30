# Live Operations — UI checkpoint mockups

**This is disposable.** It is the Phase 2 UI checkpoint from the CrashPilot +
simhark interface rebuild plan, and it establishes no application
architecture. Delete the whole directory once a direction is chosen.

The plan calls for *one* fixture-driven Live Operations mock at 1440×900. This
builds it six times, in six directions, so the direction can be chosen by
comparison rather than argued in the abstract.

They fall into two rounds. **Round 1** (A–C) all show everything at once and
differ only in presentation. **Round 2** (D–F) each pick a different rule for
what earns permanent screen space, and are much quieter as a result — they are
the answer to "these are all very busy".

## Run

```bash
npm install
npm run dev      # http://localhost:5174
```

Port 5174, so it never collides with `frontend/`'s dev server on 5173. There is
no `/api` proxy — nothing here talks to the Go backend, and nothing here is
built or embedded by `make build`.

## The six styles

### Round 1 — dense shells

| Route | Style | Direction |
|---|---|---|
| `#/evolved` | **A · Evolved** | Refined descendant of today's interface — deep navy, rounded cards, gradients, glow accents. Most familiar, least dense. |
| `#/console` | **B · Console** | Flat industrial ops console — near-black, zero radius, hairlines, tabular monospace everywhere, one amber accent, red reserved for Halt. Maximum density. |
| `#/studio` | **C · Studio** | IDE / DAW tool shell — activity bar, editor tab strips, disclosure sections, accent status bar. Panels read as dockable, previewing the Phase 4 shell. |

### Round 2 — quiet shells

| Route | Style | Rule for what stays on screen |
|---|---|---|
| `#/canvas` | **D · Canvas** | *Nothing is docked.* The field fills the window edge to edge and six floating glass islands sit over it. The inspector exists only while something is selected; the feed, the layers and the alerts are popovers. Only the overlays explaining the current command are drawn at rest. |
| `#/ledger` | **E · Ledger** | *No panels at all.* The only light direction — paper and ink, hairline rules, hierarchy from type size and whitespace. One reading column of stacked blocks replaces every tab and dock, and the squad reads as a list of sentences rather than a table. |
| `#/brief` | **F · Brief** | *One job at a time.* Navigation is a single segmented control — Operate, Review, Diagnose — and each job shows exactly two companion panels and its own overlay set. Density drops by hiding whole jobs rather than by shrinking rows. |

`#/` shows a chooser.

### Addressable states

Anything after `?` seeds a shell's initial state, so every state has a URL and
can be screenshotted without clicking:

| URL | Shows |
|---|---|
| `#/brief?ws=review` / `?ws=diagnose` | the other two workspaces |
| `#/canvas?panel=layers` / `=alerts` / `=feed` | each popover open |
| `#/canvas?layers=all` | every debug overlay turned back on |
| `#/canvas?sel=0` | nothing selected, so no inspector |
| `#/canvas?mode=review`, `#/ledger?mode=review` | review mode |

## What is shared and what is not

Shared by all six, so the comparison is about presentation only:

- `src/fixtures.js` — one frozen frame of a live match. States, tasks and modes
  are taken from the existing implementation (`frontend/src/App.jsx:3-42`).
- `src/shared/geometry.js` — SSL Division B geometry in millimetres, in the
  canonical frame from the plan (origin at field centre, +X right, +Y up,
  orientation zero along +X, CCW positive).
- `src/shared/Field.jsx` — the field renderer, which takes all its colours
  through a `theme` prop and its overlay set through an optional `overlays`
  prop. Every overlay is on unless a shell asks otherwise, so round 1 is
  unaffected by round 2 existing.

Not shared: each style owns its `Shell.jsx` and `shell.css` completely. No
common stylesheet, no shared component library. Deleting five of the six
`src/styles/*` directories leaves the sixth working.

One caveat while they coexist: the chooser loads every stylesheet at once, so a
bare (unprefixed) class name in one shell can match a selector in another.
Every class is therefore prefixed `ev-` / `cn-` / `st-` / `cv-` / `lg-` /
`br-`. Keep it that way until the losers are deleted.

`Field.jsx` is SVG, not Canvas. The real v4 renderer is Canvas 2D (plan
§Renderer); SVG is used here only because the mock is static, which keeps DPI
and resize plumbing out of a throwaway checkpoint.

## What each shell demonstrates

### Round 1

The nine things the plan asks the checkpoint to validate:

1. Dense top toolbar — session, workspace, transport, speed, recording, export, health.
2. Side-tab collapse behaviour. **The left rail starts collapsed and the right
   dock starts expanded**, so one screenshot shows both states. Clicking an
   active tab collapses its dock, per the plan.
3. Large central field, visibly the dominant element.
4. Properties / inspector sidebar.
5. Bottom dock — command feed, robot task table, referee — plus a compact timeline.
6. Status bar with frame, sim time, and a copyable build/session/frame debug token.
7. **Halt / Stop placement, deliberately different in each style** — this is one
   of the things under review, so the three do not converge:
   - Evolved: trailing edge of the toolbar.
   - Console: leading edge of the toolbar, fixed, first thing the hand reaches.
   - Studio: pinned tool overlay in the field viewport, closest to the pointer.
8. **Live vs review styling** — the `LIVE`/`REVIEW` control in each toolbar flips
   the entire shell, not just a badge: chrome colour, field desaturation, a
   Return to Live affordance, disabled Send, and the timeline head detaching
   from the live head.
9. Representative robots, debug overlays (trajectory, target, kick line,
   hologram, keep-out circle, defensive zone, pressure heatmap) and both alerts,
   all visible without interaction. Alert treatment also differs per style:
   floating toasts (Evolved), a fixed alert row (Console), an editor banner plus
   a status-bar count (Studio).

### Round 2

Round 2 keeps 3, 4, 6, 7 and 8 and deliberately breaks the rest. That is the
proposal, not an oversight — read the breaks as the question being asked:

- **1 (dense toolbar)** — none of them has one. Canvas splits it into three
  small islands, Ledger reduces it to one header line, Brief to a segmented
  control and a Halt button. Export, workspace and the health strip move into
  a popover or a workspace rather than living in the chrome.
- **2 (collapsing side rails)** — there are no rails to collapse. Canvas
  dismisses islands, Brief switches workspaces, Ledger has one column that is
  always there. If rail collapse is a requirement rather than a consequence of
  density, round 2 fails it and round 1 is the answer.
- **5 (bottom dock with three tabs)** — Canvas shows the last command as one
  line with the feed behind a disclosure, Ledger shows the last five as a short
  list, Brief shows six in the Diagnose workspace. Nobody shows fourteen rows,
  three tabs and a table at rest.
- **9 (every overlay visible at once)** — each shell draws only the overlays
  that its current job reads. `#/canvas?layers=all` turns them all back on,
  which is worth looking at: it is roughly what round 1 shows permanently.

Halt placement stays deliberately different, as in round 1: bottom-right in its
own island with nothing near it (Canvas), trailing edge of the single header
line (Ledger), header right, always in the same place in every workspace
(Brief).

## Viewing at the checkpoint size

Every shell is locked to exactly 1440×900 and letterboxed. If the browser window
is smaller the frame scales down uniformly and the bottom bar says so — enlarge
the window until it reads `shown 1:1` before judging density.
