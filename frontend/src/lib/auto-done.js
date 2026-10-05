/* A planned activity whose time has passed counts as done.
 *
 * Classes and runs are often not logged by hand. When a dated activity (S.dayPlan[iso], list or
 * single id) ends without a workout logged for it, it is saved as a workout of its own: one hour,
 * every planned set marked done, so duration, volume and muscle fatigue all see it the way they
 * see a logged session. It never feeds progression (every entry is `noProg`), claims no records
 * and is marked `auto: true`, so a Garmin import can later replace it.
 *
 * - An activity ends one hour after `routine.time` ("HH:MM") on its date, or at the end of the
 *   day when it has no time.
 * - Only dated plans count, never the default week, and only within AUTO_WINDOW_DAYS: opening
 *   the app after a while never invents months of history.
 * - Each date+routine is done at most once (`S.autoDone[key]`), so deleting an auto workout
 *   keeps it deleted, and the workout id is derived from the key, so two devices doing this at
 *   the same time merge into one (sync-merge unions workouts by id).
 */
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { workoutVolume } from './history.js'
import { exerciseMuscleSnapshot } from './muscles.js'
import { EXIDX } from './exercises.js'
import { isoOf } from './format.js'

export const AUTO_MINUTES = 60
export const AUTO_WINDOW_DAYS = 14
const MIN = 60000

const keyOf = (iso, rid) => `${iso}|${rid}`
export const autoWorkoutId = (iso, rid) => `auto-${iso}-${rid}`

/** When the activity starts: its time on that date, or noon when it has none. */
export function plannedStart(iso, routine) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(routine?.time || '')
  const d = new Date(iso + 'T00:00:00')
  if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(12, 0, 0, 0)
  return d.getTime()
}

/** When it counts as over: an hour after its time, or the end of its day. */
export function plannedEnd(iso, routine) {
  if (/^\d\d:\d\d$/.test(routine?.time || '')) return plannedStart(iso, routine) + AUTO_MINUTES * MIN
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

const loggedFor = (S, iso, rid) => (S.workouts || []).some(w =>
  w.d === iso && ([].concat(w.routineIds || []).includes(rid) || w.routineId === rid))

/** The { iso, rid } pairs that are over and have nothing logged, oldest first. */
export function dueAutoDone(S, now = Date.now()) {
  const from = new Date(now); from.setDate(from.getDate() - AUTO_WINDOW_DAYS)
  const fromIso = isoOf(from)
  const out = []
  for (const [iso, v] of Object.entries(S.dayPlan || {})) {
    if (iso < fromIso || v === 'rest') continue
    for (const rid of [].concat(v)) {
      const r = (S.routines || []).find(x => x.id === rid)
      if (!r || S.autoDone?.[keyOf(iso, rid)] || loggedFor(S, iso, rid)) continue
      if (plannedEnd(iso, r) <= now) out.push({ iso, rid })
    }
  }
  return out.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
}

/** The workout an activity becomes: every planned set done, one hour, out of progression. */
export function autoWorkout(S, iso, rid) {
  const { entries, routineIds, routines } = buildCombinedEntries(S, [rid])
  const start = plannedStart(iso, routines[0])
  const active = {
    id: autoWorkoutId(iso, rid), d: iso, start, routineIds, name: routines[0]?.name || '',
    entries: entries.map(e => ({ ...e, noProg: true, sets: e.sets.map(s => ({ ...s, done: true })) })),
  }
  const w = buildCompletedWorkout(active, {
    end: start + AUTO_MINUTES * MIN,
    snapshotFor: e => (EXIDX[e.id]?.custom ? exerciseMuscleSnapshot(EXIDX[e.id]) : null),
  })
  w.vol = workoutVolume(w)
  w.auto = true
  return w
}

/** Store mutator: log every due activity. Returns how many were added (0 → nothing changed). */
export function applyAutoDone(s, now = Date.now()) {
  const due = dueAutoDone(s, now)
  if (!due.length) return 0
  s.autoDone = s.autoDone || {}
  s.workouts = s.workouts || []
  for (const { iso, rid } of due) {
    const w = autoWorkout(s, iso, rid)
    if (!s.workouts.some(x => x.id === w.id)) s.workouts.push(w)
    s.autoDone[keyOf(iso, rid)] = 1
  }
  s.workouts.sort((a, b) => (a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1))
  return due.length
}
