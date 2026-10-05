import { describe, expect, it } from 'vitest'
import { effectiveRoutineIds } from './history.js'
import { mergeStates } from './sync-merge.js'
import {
  addToDate, removeFromDate, dropRoutineFromDates, hasDatedList, isRescheduled,
  addCategory, editCategory, deleteCategory, setRoutineCategory, categoryOf, catColor, dateColor,
} from './plan.js'
import { ACCENTS } from './format.js'

// 2026-10-07 is a Wednesday (getDay() 3); 2026-10-14 the Wednesday after.
const WED = '2026-10-07', NEXT_WED = '2026-10-14'
const state = () => ({
  routines: [{ id: 'cf', name: 'CrossFit', ex: [] }, { id: 'run', name: 'Run', ex: [] }, { id: 'hy', name: 'Hyrox', ex: [] }],
  week: { 3: ['cf'] },
  dayPlan: {},
  categories: [],
})

describe('effectiveRoutineIds with dated lists', () => {
  it('falls back to the default week when the date has nothing', () => {
    expect(effectiveRoutineIds(state(), WED)).toEqual(['cf'])
  })
  it('reads a dated list, in order, several activities', () => {
    const S = state(); S.dayPlan[WED] = ['run', 'hy']
    expect(effectiveRoutineIds(S, WED)).toEqual(['run', 'hy'])
    expect(effectiveRoutineIds(S, NEXT_WED)).toEqual(['cf'])
  })
  it('drops ids of routines that no longer exist', () => {
    const S = state(); S.dayPlan[WED] = ['gone', 'run']
    expect(effectiveRoutineIds(S, WED)).toEqual(['run'])
  })
  it('still reads a legacy single reschedule and rest', () => {
    const S = state(); S.dayPlan[WED] = 'hy'; S.dayPlan[NEXT_WED] = 'rest'
    expect(effectiveRoutineIds(S, WED)).toEqual(['hy'])
    expect(effectiveRoutineIds(S, NEXT_WED)).toEqual([])
  })
})

describe('editing a date', () => {
  it('first add copies the default week in, then appends', () => {
    const S = state()
    addToDate(S, WED, 'run')
    expect(S.dayPlan[WED]).toEqual(['cf', 'run'])
    expect(hasDatedList(S, WED)).toBe(true)
    // the default week and other Wednesdays are untouched
    expect(S.week[3]).toEqual(['cf'])
    expect(effectiveRoutineIds(S, NEXT_WED)).toEqual(['cf'])
  })
  it('does not add the same routine twice', () => {
    const S = state()
    addToDate(S, WED, 'cf')
    expect(S.dayPlan[WED]).toBeUndefined()
  })
  it('a dated list is not a reschedule', () => {
    const S = state()
    addToDate(S, WED, 'run')
    expect(isRescheduled(S, WED)).toBe(false)
    S.dayPlan[NEXT_WED] = 'hy'
    expect(isRescheduled(S, NEXT_WED)).toBe(true)
  })
  it('removing keeps the rest of the date and does not touch the default week', () => {
    const S = state()
    addToDate(S, WED, 'run')
    removeFromDate(S, WED, 'cf')
    expect(S.dayPlan[WED]).toEqual(['run'])
    expect(S.week[3]).toEqual(['cf'])
  })
  it('removing the last activity makes the date rest, not the default again', () => {
    const S = state()
    removeFromDate(S, WED, 'cf')
    expect(S.dayPlan[WED]).toBe('rest')
    expect(effectiveRoutineIds(S, WED)).toEqual([])
  })
  it('later changes to the default week no longer reach an edited date', () => {
    const S = state()
    addToDate(S, WED, 'run')
    S.week[3] = ['hy']
    expect(effectiveRoutineIds(S, WED)).toEqual(['cf', 'run'])
    expect(effectiveRoutineIds(S, NEXT_WED)).toEqual(['hy'])
  })
})

describe('deleting a routine', () => {
  it('pulls it from dated lists and drops reschedules to it', () => {
    const S = state()
    S.dayPlan = { [WED]: ['cf', 'run'], '2026-10-08': ['run'], '2026-10-09': 'run', '2026-10-10': 'hy' }
    const before = dropRoutineFromDates(S, 'run')
    expect(S.dayPlan).toEqual({ [WED]: ['cf'], '2026-10-08': 'rest', '2026-10-10': 'hy' })
    expect(before).toEqual({ [WED]: ['cf', 'run'], '2026-10-08': ['run'], '2026-10-09': 'run' })
  })
})

describe('categories', () => {
  it('creates, edits and colours a category', () => {
    const S = state()
    const c = addCategory(S, '  Running ', 'sage')
    expect(S.categories).toEqual([{ id: c.id, name: 'Running', color: 'sage' }])
    editCategory(S, c.id, { name: 'Runs', color: 'ocean' })
    expect(S.categories[0]).toMatchObject({ name: 'Runs', color: 'ocean' })
    expect(catColor(S.categories[0])).toBe(ACCENTS.ocean)
  })
  it('refuses an empty name and an unknown colour', () => {
    const S = state()
    expect(addCategory(S, '   ', 'sage')).toBeNull()
    expect(addCategory(S, 'Class', 'notacolour').color).toBe('pink')
  })
  it('assigns a routine and colours its dates', () => {
    const S = state()
    const c = addCategory(S, 'Class', 'ocean')
    setRoutineCategory(S, 'cf', c.id)
    expect(categoryOf(S, S.routines[0])).toEqual(c)
    expect(dateColor(S, WED)).toBe(ACCENTS.ocean)
    expect(dateColor(S, '2026-10-08')).toBeNull()
    setRoutineCategory(S, 'cf', 'missing')
    expect(S.routines[0].cat).toBeUndefined()
  })
  it('deleting a category clears it from its routines', () => {
    const S = state()
    const c = addCategory(S, 'Class', 'ocean')
    setRoutineCategory(S, 'cf', c.id)
    setRoutineCategory(S, 'hy', c.id)
    deleteCategory(S, c.id)
    expect(S.categories).toEqual([])
    expect(S.routines.some(r => 'cat' in r)).toBe(false)
  })
  it('merges by id across devices', () => {
    const a = { ...state(), _ts: 2, workouts: [], bodyweight: [], categories: [{ id: 'x', name: 'Class', color: 'ocean' }] }
    const b = { ...state(), _ts: 1, workouts: [], bodyweight: [], categories: [{ id: 'x', name: 'Old', color: 'pink' }, { id: 'y', name: 'Run', color: 'sage' }] }
    expect(mergeStates(a, b).categories).toEqual([{ id: 'x', name: 'Class', color: 'ocean' }, { id: 'y', name: 'Run', color: 'sage' }])
  })
})
