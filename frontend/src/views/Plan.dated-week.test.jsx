// @vitest-environment happy-dom
// The Plan screen shows real dates: each week its own activities (several per day allowed),
// the default week only filling dates with nothing of their own, and category colours.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { ACCENTS } from '../lib/format.js'

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
const sheets = vi.hoisted(() => ({ dateAddRoutineSheet: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
  calendarSheet: vi.fn(), categoriesSheet: vi.fn(), dateAddRoutineSheet: sheets.dateAddRoutineSheet,
}))

let host, root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T10:00:00'))   // a Wednesday
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, weekStart: 1,
    categories: [{ id: 'c1', name: 'Class', color: 'ocean' }],
    routines: [
      { id: 'cf', name: 'CrossFit', emoji: null, ex: [], cat: 'c1' },
      { id: 'run', name: 'Easy run', emoji: null, ex: [] },
      { id: 'hy', name: 'Hyrox', emoji: null, ex: [], cat: 'c1' },
    ],
    week: { 3: ['cf'] },
    dayPlan: { '2026-10-08': ['run', 'hy'] },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const mount = () => act(() => root.render(<Plan />))
const dated = () => [...host.querySelectorAll('.plan-dates > .item')]
const names = row => [...row.querySelectorAll('.plan-act .tt')].map(e => e.textContent)
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('Plan — dated week', () => {
  it('shows this week, Monday first, with the default week and dated lists', () => {
    mount()
    const rows = dated()
    expect(rows).toHaveLength(7)
    expect(rows[0].querySelector('.tt').textContent).toContain('5')     // Mon 5 Oct
    expect(rows[2].className).toContain('plan-today')
    expect(names(rows[2])).toEqual(['CrossFit'])                       // default week
    expect(names(rows[3])).toEqual(['Easy run', 'Hyrox'])              // its own list, two activities
    expect(rows[3].textContent).not.toMatch(/rescheduled/i)
    expect(host.querySelector('.plan-wklabel').textContent).toBe('This week')
  })

  it('colours an activity by its category', () => {
    mount()
    const act0 = dated()[2].querySelector('.plan-act')
    expect(act0.style.getPropertyValue('--cat')).toBe(ACCENTS.ocean)
    expect(host.querySelector('.plan-legend').textContent).toContain('Class')
  })

  it('removing from a date changes that date only', () => {
    mount()
    click(dated()[2].querySelector('.plan-act button'))
    expect(mocks.S.dayPlan['2026-10-07']).toBe('rest')
    expect(mocks.S.week[3]).toEqual(['cf'])
  })

  it('next week falls back to the default week', () => {
    mount()
    click(host.querySelector('[aria-label="Next week"]'))
    const rows = dated()
    expect(rows[0].querySelector('.tt').textContent).toContain('12')
    expect(names(rows[2])).toEqual(['CrossFit'])
    expect(names(rows[3])).toEqual([])
    expect(host.querySelector('.plan-wklabel').textContent).not.toBe('This week')
  })

  it('＋ Add routine opens the picker for that date', () => {
    mount()
    const add = [...dated()[3].querySelectorAll('button')].find(b => b.textContent.includes('Add routine'))
    click(add)
    expect(sheets.dateAddRoutineSheet).toHaveBeenCalledWith('2026-10-08')
  })
})
