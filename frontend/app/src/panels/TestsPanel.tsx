// simhark's test suite: counts, filtering, failure messages and click-to-focus
// on the world a test failed in.
//
// The suite arrives as an opaque `test_suite` snapshot property rather than as
// protocol state, because its shape belongs to `simhark_testing`. It is read
// defensively for that reason: an unknown or absent suite renders as "no
// tests", never as a broken panel.

import { useState } from 'react'

import { useConfig } from '../config/ConfigContext'
import { useLiveTick, useMeta, useStore } from '../store/hooks'
import { Empty, SectionTitle } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import './tests.css'

type Outcome = 'running' | 'passed' | 'failed' | 'timed_out'

interface TestStatus {
  world_id: number
  path: string[]
  name: string
  outcome: Outcome
  frame: number
  message: string | null
}

interface TestSuite {
  passed: number
  failed: number
  timed_out: number
  running: number
  tests: TestStatus[]
}

type Filter = 'all' | Outcome

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Failed' },
  { id: 'timed_out', label: 'Timed out' },
]

export function TestsPanel() {
  const store = useStore()
  const meta = useMeta()
  const { updateField } = useConfig()
  const [filter, setFilter] = useState<Filter>('all')
  useLiveTick()

  const suite = readSuite(store.getSnapshotProperties()['test_suite'])
  const simharkId = systemIdOfKind(meta, 'simhark')
  const mutable = canMutate(meta)

  if (!suite) {
    return (
      <Empty
        title="No test suite"
        hint="Run simhark with a test suite and its status appears here."
      />
    )
  }

  const shown =
    filter === 'all' ? suite.tests : suite.tests.filter((test) => test.outcome === filter)

  /** Focuses the world a test ran in, and tells the simulator to publish it. */
  const focus = (worldId: number) => {
    updateField({ multiWorld: 'focus', focusWorldId: worldId })
    if (!simharkId || !mutable) return
    store.send(
      'tests',
      {
        type: 'system',
        data: {
          system_id: simharkId,
          command: { type: 'simhark', data: { type: 'select_worlds', data: { world_ids: [worldId] } } },
        },
      },
      `focus world ${worldId}`,
    )
    if (meta.cursor) store.setCursor({ ...meta.cursor, world_ids: [worldId] })
  }

  return (
    <div className="ui-scroll ts">
      <div className="ts-counts">
        <Count label="Run" value={suite.tests.length} />
        <Count label="Pass" value={suite.passed} tone="ok" />
        <Count label="Fail" value={suite.failed} tone="error" />
        <Count label="Timeout" value={suite.timed_out} tone="warn" />
        <Count label="Active" value={suite.running} />
      </div>

      <div className="ts-filters">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            className={`ts-filter ${filter === option.id ? 'is-on' : ''}`}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <SectionTitle aside={`${shown.length}`}>Tests</SectionTitle>
      {shown.length === 0 ? (
        <Empty title={`No ${filter === 'all' ? '' : FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} tests`.replace('  ', ' ')} />
      ) : (
        <div className="ts-list">
          {shown.map((test, index) => (
            <button
              key={`${test.world_id}:${test.path.join('/')}:${test.name}:${index}`}
              className={`ts-row ts-row--${test.outcome}`}
              onClick={() => focus(test.world_id)}
              title={`Focus world ${test.world_id}`}
            >
              <span className={`ts-dot ts-dot--${test.outcome}`} />
              <span className="ts-name">
                {test.path.length > 0 && <i>{test.path.join(' › ')} › </i>}
                {test.name}
              </span>
              <span className="ui-mono ts-meta">
                w{test.world_id} · f{test.frame.toLocaleString()}
              </span>
              {test.message && <span className="ts-message">{test.message}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Count({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'ok' | 'warn' | 'error'
}) {
  return (
    <div className={`ts-count ${tone ? `ts-count--${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

/** Accepts only a suite that actually looks like one. */
function readSuite(value: unknown): TestSuite | null {
  if (typeof value !== 'object' || value === null) return null
  const suite = value as Partial<TestSuite>
  if (!Array.isArray(suite.tests)) return null
  return {
    passed: numberOr(suite.passed),
    failed: numberOr(suite.failed),
    timed_out: numberOr(suite.timed_out),
    running: numberOr(suite.running),
    tests: suite.tests.filter((test): test is TestStatus => typeof test?.name === 'string'),
  }
}

function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
