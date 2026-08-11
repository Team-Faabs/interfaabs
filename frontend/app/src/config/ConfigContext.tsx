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
import { STORAGE_KEY, flushConfig, loadConfig, saveConfig } from './persistence'
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

  // The debounced write must survive the page going away: a rebuilt host
  // reloads the tab from under the operator, and `pagehide` is the last point
  // at which storage is still writable.
  useEffect(() => {
    const flush = () => flushConfig()
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushConfig()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
      flushConfig()
    }
  }, [])

  // Every write stores the whole config, so a second window holding a copy from
  // when it loaded would put that copy back the next time anything changed in
  // it, undoing whatever was arranged over here. Adopting the other window's
  // write keeps the two in step instead.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return
      setConfig((current) => {
        const stored = loadConfig().config
        // Which workspace a window shows is a per-window choice; everything
        // else is one shared document.
        const next = stored.workspaces.some((w) => w.id === current.activeWorkspaceId)
          ? { ...stored, activeWorkspaceId: current.activeWorkspaceId }
          : stored
        // Identical content has to keep the same object, or two windows would
        // trade writes forever, each one waking the other.
        return JSON.stringify(next) === JSON.stringify(current) ? current : next
      })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

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
    setConfig((current) => {
      // Resolved the same way the rendered workspace is, so a dangling active
      // id cannot make every layout change land on no workspace at all and be
      // dropped without a trace.
      const target = current.workspaces.some((w) => w.id === current.activeWorkspaceId)
        ? current.activeWorkspaceId
        : current.workspaces[0]?.id
      return {
        ...current,
        workspaces: current.workspaces.map((workspace) =>
          workspace.id === target ? { ...workspace, layout } : workspace,
        ),
      }
    })
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
