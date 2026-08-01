import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { DockNode } from '../docking/model'
import { defaultWorkspaces } from './defaults'
import { loadConfig, saveConfig } from './persistence'
import type { AppConfig, FieldSettings, WorkspaceConfig } from './types'

interface ConfigContextValue {
  config: AppConfig
  workspace: WorkspaceConfig
  /** Non-null when a corrupt or unmigratable stored config was discarded. */
  recovered: string | null
  dismissRecovered: () => void
  update: (patch: Partial<AppConfig>) => void
  updateField: (patch: Partial<FieldSettings>) => void
  updateWorkspace: (id: string, patch: Partial<WorkspaceConfig>) => void
  setLayout: (layout: DockNode) => void
  setActiveWorkspace: (id: string) => void
  addWorkspace: (workspace: WorkspaceConfig) => void
  removeWorkspace: (id: string) => void
  resetWorkspace: (id: string) => void
  resetAll: () => void
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const initial = useRef(loadConfig()).current
  const [config, setConfig] = useState<AppConfig>(initial.config)
  const [recovered, setRecovered] = useState<string | null>(initial.recovered)

  useEffect(() => {
    saveConfig(config)
  }, [config])

  const update = useCallback((patch: Partial<AppConfig>) => {
    setConfig((current) => ({ ...current, ...patch }))
  }, [])

  const updateField = useCallback((patch: Partial<FieldSettings>) => {
    setConfig((current) => ({ ...current, field: { ...current.field, ...patch } }))
  }, [])

  const updateWorkspace = useCallback((id: string, patch: Partial<WorkspaceConfig>) => {
    setConfig((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, ...patch } : workspace,
      ),
    }))
  }, [])

  const setLayout = useCallback((layout: DockNode) => {
    setConfig((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === current.activeWorkspaceId ? { ...workspace, layout } : workspace,
      ),
    }))
  }, [])

  const setActiveWorkspace = useCallback((id: string) => {
    setConfig((current) =>
      current.workspaces.some((workspace) => workspace.id === id)
        ? { ...current, activeWorkspaceId: id }
        : current,
    )
  }, [])

  const addWorkspace = useCallback((workspace: WorkspaceConfig) => {
    setConfig((current) => ({
      ...current,
      workspaces: [...current.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    }))
  }, [])

  const removeWorkspace = useCallback((id: string) => {
    setConfig((current) => {
      const target = current.workspaces.find((workspace) => workspace.id === id)
      if (!target || target.builtin) return current
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== id)
      return {
        ...current,
        workspaces,
        activeWorkspaceId:
          current.activeWorkspaceId === id ? workspaces[0].id : current.activeWorkspaceId,
      }
    })
  }, [])

  const resetWorkspace = useCallback((id: string) => {
    const pristine = defaultWorkspaces().find((workspace) => workspace.id === id)
    if (!pristine) return
    setConfig((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === id ? pristine : workspace,
      ),
    }))
  }, [])

  const resetAll = useCallback(() => {
    setConfig((current) => ({
      ...current,
      workspaces: defaultWorkspaces(),
      activeWorkspaceId: 'live-ops',
    }))
  }, [])

  const workspace = useMemo(
    () =>
      config.workspaces.find((entry) => entry.id === config.activeWorkspaceId) ??
      config.workspaces[0],
    [config],
  )

  const value = useMemo<ConfigContextValue>(
    () => ({
      config,
      workspace,
      recovered,
      dismissRecovered: () => setRecovered(null),
      update,
      updateField,
      updateWorkspace,
      setLayout,
      setActiveWorkspace,
      addWorkspace,
      removeWorkspace,
      resetWorkspace,
      resetAll,
    }),
    [
      config,
      workspace,
      recovered,
      update,
      updateField,
      updateWorkspace,
      setLayout,
      setActiveWorkspace,
      addWorkspace,
      removeWorkspace,
      resetWorkspace,
      resetAll,
    ],
  )

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext)
  if (!value) throw new Error('useConfig outside ConfigProvider')
  return value
}
