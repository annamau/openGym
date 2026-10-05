// @vitest-environment happy-dom
// A weekday with one routine read "1 routines" (QA copy): the header formatted the count
// with the plural key only, although both forms have been in every pack for a long time.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))
const countOn = iso => host.querySelectorAll('.plan-dates > .item')[(new Date(iso + 'T12:00:00').getDay() + 6) % 7]?.querySelector('.small.dim')?.textContent

describe('Plan — the day header counts its routines', () => {
  it('uses the singular for one routine and the plural for more', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T10:00:00'))
    mocks.S.dayPlan = { '2026-10-05': ['r1'], '2026-10-06': ['r1', 'r2'] }
    mount()
    expect(countOn('2026-10-05')).toBe('1 routine')
    expect(countOn('2026-10-06')).toBe('2 routines')
    vi.useRealTimers()
  })
})
