import type { SystemId, SystemKind } from '../protocol/types'
import type { MetaState } from '../store/store'

export function systemIdOfKind(meta: MetaState, kind: SystemKind): SystemId | null {
  return meta.systems.find((system) => system.kind === kind)?.id ?? null
}

export function hasCapability(meta: MetaState, capabilityId: string): boolean {
  return (
    meta.capabilities.includes(capabilityId) ||
    meta.systems.some((system) =>
      system.capabilities.some((capability) => capability.id === capabilityId),
    )
  )
}

export function isCapabilityMutable(meta: MetaState, capabilityId: string): boolean {
  return meta.systems.some((system) =>
    system.capabilities.some(
      (capability) => capability.id === capabilityId && capability.mutable,
    ),
  )
}

/** Referris UI is hidden entirely when the host does not advertise it. */
export function referrisAvailable(meta: MetaState): boolean {
  return meta.systems.some((system) => system.kind === 'referris')
}

export function activeSession(meta: MetaState) {
  return meta.sessions.find((session) => session.id === meta.activeSessionId) ?? null
}

/** A command may be issued when the session is mutable and the cursor is live. */
export function canMutate(meta: MetaState): boolean {
  if (meta.cursor && !meta.cursor.live) return false
  const session = activeSession(meta)
  return session ? session.mutable : meta.sessions.length === 0
}
