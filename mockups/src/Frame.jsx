import { useEffect, useState } from 'react'

const W = 1440
const H = 900

// Locks every shell to exactly 1440×900 and letterboxes the rest, so density is
// judged at the checkpoint size rather than at whatever the window happens to
// be. If the window is smaller the frame scales down uniformly and says so.
export default function Frame({ children }) {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const scale = Math.min(1, vp.w / W, (vp.h - 26) / H)
  const exact = scale === 1

  return (
    <div className="frame-root">
      <div
        className="frame-stage"
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
      <div className="frame-bar">
        <a href="#/">← styles</a>
        <span>
          checkpoint canvas <b>1440 × 900</b>
        </span>
        <span className={exact ? 'ok' : 'warn'}>
          {exact
            ? 'shown 1:1'
            : `scaled to ${(scale * 100).toFixed(0)}% — viewport ${vp.w}×${vp.h}, enlarge the window for a true reading`}
        </span>
      </div>
    </div>
  )
}
