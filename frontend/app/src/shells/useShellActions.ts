import { useCallback } from 'react'

import { useConfig } from '../config/ConfigContext'
import { openPanel } from '../docking/model'

/** Opens a panel type in the active workspace, or focuses an existing one. */
export function useOpenPanel(): (panelType: string) => void {
  const { workspace, setLayout } = useConfig()
  return useCallback(
    (panelType: string) => setLayout(openPanel(workspace.layout, panelType)),
    [workspace.layout, setLayout],
  )
}
