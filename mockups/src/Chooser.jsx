// Two rounds of directions. The first three answer "how should the dense
// shell look"; the second three answer "does it have to be dense at all".
const ROUNDS = [
  {
    title: 'Round 1 — dense shells',
    line:
      'Everything on screen at once: five docks, every overlay drawn, every table populated. They differ in presentation, not in how much they show.',
    styles: [
      {
        hash: '#/evolved',
        name: 'A · Evolved',
        line: 'Refined descendant of today’s interface',
        body:
          'Deep navy, rounded cards, gradient surfaces, glow accents. Answers “what if we just do the current design properly.” Most familiar, least dense.',
        swatch: ['#07111f', '#101d33', '#5f76ff', '#32d7c4'],
      },
      {
        hash: '#/console',
        name: 'B · Console',
        line: 'Flat industrial operations console',
        body:
          'Near-black, zero radius, 1px hairlines, tabular monospace on every number, one amber accent, red reserved for Halt. ~40% more rows in the same dock.',
        swatch: ['#0a0a0b', '#151517', '#ffb020', '#ff3b30'],
      },
      {
        hash: '#/studio',
        name: 'C · Studio',
        line: 'IDE / DAW tool shell',
        body:
          'Two-tone neutral chrome, vertical activity bar, real tab strips, disclosure sections. Panels read as dockable — previews the Phase 4 shell.',
        swatch: ['#1e1e22', '#2a2a30', '#4a8cff', '#3fb950'],
      },
    ],
  },
  {
    title: 'Round 2 — quiet shells',
    line:
      'The same fixture, the same frame, deliberately not all at once. Each one picks a different rule for what earns permanent screen space; the rest is a click or a workspace away.',
    styles: [
      {
        hash: '#/canvas',
        name: 'D · Canvas',
        line: 'No shell — floating islands over a full-bleed field',
        body:
          'The field is the window, edge to edge. Six small glass islands float over it and the inspector only exists while something is selected. Nothing is docked, and only the overlays explaining the current command are drawn at rest.',
        swatch: ['#0b0f0e', '#16211c', '#6ea8fe', '#5fd39a'],
      },
      {
        hash: '#/ledger',
        name: 'E · Ledger',
        line: 'Light editorial two-column',
        body:
          'The only light direction. Paper and ink, hairline rules instead of panels, hierarchy carried by type size and whitespace. One reading column replaces every tab and dock, and the squad reads as a list of sentences rather than a table.',
        swatch: ['#f6f6f3', '#e6ebe4', '#2f6bd8', '#cf3b2f'],
      },
      {
        hash: '#/brief',
        name: 'F · Brief',
        line: 'Three named jobs, two panels each',
        body:
          'Warm chrome and a single segmented control — Operate, Review, Diagnose. Each job shows exactly two companion panels and its own overlay set. Density drops by hiding whole jobs instead of by shrinking rows, so nothing is smaller than comfortable.',
        swatch: ['#16150f', '#1e1c16', '#d9a441', '#7aa5e8'],
      },
    ],
  },
]

export default function Chooser() {
  return (
    <div className="chooser">
      <header>
        <h1>Live Operations — UI checkpoint</h1>
        <p>
          Phase 2 of the interfaabs + simhark interface rebuild. One fixture-driven mock,
          built six times so the direction can be chosen by comparison. Fixtures, field
          geometry and the field renderer are shared; everything else is independent per
          style. Disposable — this establishes no architecture.
        </p>
      </header>

      {ROUNDS.map((r) => (
        <section className="chooser-round" key={r.title}>
          <h2 className="chooser-round-title">{r.title}</h2>
          <p className="chooser-round-line">{r.line}</p>
          <div className="chooser-grid">
            {r.styles.map((s) => (
              <a className="chooser-card" href={s.hash} key={s.hash}>
                <div className="chooser-swatch">
                  {s.swatch.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </div>
                <h3>{s.name}</h3>
                <p className="chooser-line">{s.line}</p>
                <p className="chooser-body">{s.body}</p>
                <span className="chooser-go">Open at 1440×900 →</span>
              </a>
            ))}
          </div>
        </section>
      ))}

      <footer>
        Every shell has a <b>live / review</b> control that flips the whole frame, not just a
        badge. In round 1 the rails also collapse, and both start in opposite states so one
        screenshot shows collapsed and expanded together. Round 2 has no rails to collapse —
        that is the point of it.
      </footer>
    </div>
  )
}
