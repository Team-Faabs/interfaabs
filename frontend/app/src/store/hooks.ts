import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'

import type { DebugItem, WorldState } from '../protocol/types'
import type { InterfaceStore, MetaState, WorldFrame } from './store'

export const StoreContext = createContext<InterfaceStore | null>(null)

export function useStore(): InterfaceStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore outside StoreProvider')
  return store
}

/** Subscribes to the slow tier. Safe to call from anything. */
export function useMeta(): MetaState {
  const store = useStore()
  return useSyncExternalStore(store.subscribeMeta, store.getMeta, store.getMeta)
}

export function useMetaSelector<T>(select: (meta: MetaState) => T): T {
  return select(useMeta())
}

/**
 * Subscribes to the ~10 Hz frame channel. Use for panels that display live
 * numbers; never for anything that must be pixel-accurate per frame — the
 * canvas reads the store directly inside its own rAF loop instead.
 */
export function useLiveTick(): number {
  const store = useStore()
  return useSyncExternalStore(
    store.liveTick.subscribe,
    store.liveTick.getVersion,
    store.liveTick.getVersion,
  )
}

export function useWorld(worldId: number | null): WorldFrame | undefined {
  const store = useStore()
  const tick = useLiveTick()
  return useMemo(
    () => (worldId === null ? undefined : store.getWorld(worldId)),
    // `tick` is the dependency that makes this recompute; it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, worldId, tick],
  )
}

export function useWorlds(): WorldFrame[] {
  const store = useStore()
  const tick = useLiveTick()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.getWorlds(), [store, tick])
}

export function useDebugItems(worldId: number | null): DebugItem[] {
  const store = useStore()
  const tick = useLiveTick()
  return useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => (worldId === null ? [] : store.getDebugItems(worldId)),
    [store, worldId, tick],
  )
}

/** The world the shell currently considers primary. */
export function usePrimaryWorld(): WorldState | null {
  const meta = useMeta()
  const worlds = useWorlds()
  const preferred = meta.cursor?.world_ids?.[0]
  const frame =
    (preferred !== undefined ? worlds.find((w) => w.world.world_id === preferred) : undefined) ??
    worlds[0]
  return frame?.world ?? null
}
