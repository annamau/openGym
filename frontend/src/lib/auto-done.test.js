import { describe, expect, it } from 'vitest'
import { dueAutoDone, applyAutoDone, plannedEnd, autoWorkoutId, AUTO_WINDOW_DAYS } from './auto-done.js'
import { mergeStates } from './sync-merge.js'

const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`).getTime()
const state = () => ({
  unit: 'kg', exWeights: {}, workouts: [], week: { 1: ['up'] }, autoDone: {},
  routines: [
    { id: 'cf', name: 'CrossFit · Mon 5 Oct', time: '07:00', excludeFromProgression: true,
      ex: [{ id: '0662', sets: 3, reps: 10, weight: 0 }, { id: '0043', sets: 5, reps: 5, weight: 60 }] },
    { id: 'run', name: 'BASELINE 5 km', time: '18:00', ex: [] },
    { id: 'up', name: 'Upper body', ex: [{ id: '0662', sets: 2, reps: 8, weight: 0 }] },
  ],
  dayPlan: { '2026-10-05': ['cf', 'run'], '2026-10-06': 'rest', '2026-10-07': ['up'] },
})

describe('auto-done: when an activity counts as over', () => {
  it('an hour after its time, or at the end of its day without one', () => {
    const S = state()
    expect(plannedEnd('2026-10-05', S.routines[0])).toBe(at('2026-10-05', '08:00'))
    expect(plannedEnd('2026-10-07', S.routines[2])).toBe(at('2026-10-08', '00:00'))
  })
  it('only activities whose end has passed are due; rest days and the default week never are', () => {
    const S = state()
    expect(dueAutoDone(S, at('2026-10-05', '07:59'))).toEqual([])
    expect(dueAutoDone(S, at('2026-10-05', '08:00'))).toEqual([{ iso: '2026-10-05', rid: 'cf' }])
    expect(dueAutoDone(S, at('2026-10-05', '19:00'))).toEqual([{ iso: '2026-10-05', rid: 'cf' }, { iso: '2026-10-05', rid: 'run' }])
    // Monday 12 is "up" only through the default week: not counted
    expect(dueAutoDone(S, at('2026-10-13', '12:00')).map(d => d.iso)).toEqual(['2026-10-05', '2026-10-05', '2026-10-07'])
  })
  it('a workout logged for it, an old date, or one already handled is not due', () => {
    const S = state()
    S.workouts = [{ id: 'w', d: '2026-10-05', routineIds: ['cf'], entries: [] }]
    S.autoDone['2026-10-05|run'] = 1
    expect(dueAutoDone(S, at('2026-10-06', '12:00'))).toEqual([])
    expect(dueAutoDone(state(), at('2026-10-05', '20:00') + (AUTO_WINDOW_DAYS + 3) * 86400000)).toEqual([])
  })
})

describe('auto-done: the workout it becomes', () => {
  it('one hour, every planned set done, volume counted, out of progression', () => {
    const S = state()
    expect(applyAutoDone(S, at('2026-10-05', '09:00'))).toBe(1)
    const w = S.workouts[0]
    expect(w.id).toBe(autoWorkoutId('2026-10-05', 'cf'))
    expect(w.auto).toBe(true)
    expect(w.end - w.start).toBe(3600000)
    expect(w.start).toBe(at('2026-10-05', '07:00'))
    expect(w.entries).toHaveLength(2)
    expect(w.entries.every(e => e.noProg === true && e.sets.every(s => s.done))).toBe(true)
    expect(w.vol).toBeGreaterThan(0)
    expect(w.prs).toEqual([])
    expect(S.exWeights).toEqual({})
  })
  it('an activity without exercises (a run) still logs its hour', () => {
    const S = state()
    applyAutoDone(S, at('2026-10-05', '19:00'))
    const run = S.workouts.find(w => w.id === autoWorkoutId('2026-10-05', 'run'))
    expect(run.end - run.start).toBe(3600000)
    expect(run.entries).toEqual([])
  })
  it('runs once: a deleted auto workout stays deleted', () => {
    const S = state()
    applyAutoDone(S, at('2026-10-05', '09:00'))
    S.workouts = []
    expect(applyAutoDone(S, at('2026-10-05', '10:00'))).toBe(0)
  })
  it('two devices doing it at once merge into one workout', () => {
    const a = state(), b = state()
    applyAutoDone(a, at('2026-10-05', '09:00')); a._ts = 2
    applyAutoDone(b, at('2026-10-05', '09:05')); b._ts = 1
    a.bodyweight = []; b.bodyweight = []
    expect(mergeStates(a, b).workouts).toHaveLength(1)
  })
})
