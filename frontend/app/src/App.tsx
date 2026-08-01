import { useEffect, useRef } from 'react'

import { ConfigProvider, useConfig } from './config/ConfigContext'
import { Shell } from './shells/Shell'
import { StoreContext, useStore } from './store/hooks'
import { InterfaceStore } from './store/store'
import { ThemeProvider } from './theme/ThemeProvider'
import './app.css'

export default function App() {
  const storeRef = useRef<InterfaceStore | null>(null)
  if (storeRef.current === null) storeRef.current = new InterfaceStore()

  useEffect(() => {
    const store = storeRef.current
    store?.connect()
    return () => store?.disconnect()
  }, [])

  return (
    <StoreContext.Provider value={storeRef.current}>
      <ConfigProvider>
        <ThemeProvider>
          <WorkstationLabelBridge />
          <Shell />
        </ThemeProvider>
      </ConfigProvider>
    </StoreContext.Provider>
  )
}

/**
 * The workstation label lives in the persisted config but travels on every
 * command, so it is mirrored onto the store rather than threaded through the
 * command call sites.
 */
function WorkstationLabelBridge() {
  const { config } = useConfig()
  const store = useStore()
  useEffect(() => {
    store.workstationLabel = config.workstationLabel
  }, [store, config.workstationLabel])
  return null
}
