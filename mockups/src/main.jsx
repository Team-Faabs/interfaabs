import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './app.css'
import Chooser from './Chooser'
import Frame from './Frame'
import Evolved from './styles/evolved/Shell'
import Console from './styles/console/Shell'
import Studio from './styles/studio/Shell'
import CanvasShell from './styles/canvas/Shell'
import Ledger from './styles/ledger/Shell'
import Brief from './styles/brief/Shell'

const ROUTES = {
  '#/evolved': Evolved,
  '#/console': Console,
  '#/studio': Studio,
  '#/canvas': CanvasShell,
  '#/ledger': Ledger,
  '#/brief': Brief,
}

// `#/brief?ws=diagnose` — the part after ? seeds the shell's initial state, so
// every state of every shell has a URL and can be screenshotted without
// clicking. Shells read it through the `params` prop and are otherwise
// normal stateful components.
function parse(hash) {
  const [route, query = ''] = hash.split('?')
  return { route, params: new URLSearchParams(query) }
}

function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { route, params } = parse(hash)
  const Shell = ROUTES[route]
  if (!Shell) return <Chooser />
  return (
    <Frame>
      {/* keyed on the query so a hash change re-seeds initial state */}
      <Shell key={hash} params={params} />
    </Frame>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
