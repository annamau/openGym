/* Dated plan + activity categories.
 *
 * `S.week` is the default week: weekday → routine-id list, repeating forever. `S.dayPlan[iso]`
 * is what one date holds instead. Three shapes live there:
 *   - a routine-id list — the date's own activities, any number of them. Written by the Plan
 *     screen's dated week; the first edit copies the weekday's default in, so from then on the
 *     date stands on its own and later changes to the default week no longer reach it.
 *   - a single routine id — the older single-pick "reschedule" (dayOverrideSheet).
 *   - `'rest'` — nothing planned that date.
 * An absent key falls back to the default week. `effectiveRoutineIds` (history.js) reads all of
 * them; the helpers below are the only writers of the list shape.
 *
 * Categories are per profile: `S.categories = [{ id, name, color }]`, `color` a key of ACCENTS.
 * A routine carries at most one (`routine.cat`), so an activity wears the same colour on every
 * date it appears.
 */
import { effectiveRoutineIds } from './history.js'
import { ACCENTS, uid } from './format.js'

/** True when the date holds its own activity list (as opposed to the default week or a reschedule). */
export const hasDatedList = (S, iso) => Array.isArray(S.dayPlan?.[iso])

/** The single-pick reschedule only — a dated list is the plan for that week, not a change to it. */
export const isRescheduled = (S, iso) => {
  const v = S.dayPlan?.[iso]
  return v !== undefined && !Array.isArray(v)
}

// An emptied date is rest, not "back to default": the user cleared it on purpose.
function setDate(s, iso, ids) {
  if (!s.dayPlan) s.dayPlan = {}
  s.dayPlan[iso] = ids.length ? ids : 'rest'
}

/** Append a routine to a date. The first edit starts from what the date showed until now. */
export function addToDate(s, iso, routineId) {
  const cur = effectiveRoutineIds(s, iso)
  if (cur.includes(routineId)) return
  setDate(s, iso, [...cur, routineId])
}

/** Pull one routine off a date; the date keeps everything else it showed. */
export function removeFromDate(s, iso, routineId) {
  setDate(s, iso, effectiveRoutineIds(s, iso).filter(id => id !== routineId))
}

/**
 * Forget a deleted routine in every date. A reschedule pointing at it is dropped (the date falls
 * back to the default week, as before); a list loses the id and becomes rest if that empties it.
 * Returns the previous value of every date it touched, for callers that keep an undo record.
 */
export function dropRoutineFromDates(s, routineId) {
  const before = {}
  Object.keys(s.dayPlan || {}).forEach(iso => {
    const v = s.dayPlan[iso]
    if (Array.isArray(v)) {
      if (!v.includes(routineId)) return
      before[iso] = v
      const next = v.filter(id => id !== routineId)
      s.dayPlan[iso] = next.length ? next : 'rest'
    } else if (v === routineId) {
      before[iso] = v
      delete s.dayPlan[iso]
    }
  })
  return before
}

/* ------------------------------------------------------------------ categories -- */

export const CAT_COLORS = Object.keys(ACCENTS)
/** One-tap starters, the four kinds of session a week of classes and runs is made of. */
export const SUGGESTED_CATS = [
  { name: 'Class', color: 'ocean' },
  { name: 'Free workout', color: 'pink' },
  { name: 'Running', color: 'sage' },
  { name: 'Other', color: 'amber' },
]

export const catColor = c => ACCENTS[c?.color] || ACCENTS.pink

/** The category a routine belongs to, or null (none set, or it was deleted). */
export function categoryOf(S, routine) {
  if (!routine?.cat) return null
  return (S.categories || []).find(c => c.id === routine.cat) || null
}

/** The colour a date's dot takes: its first categorised activity's, or null. */
export function dateColor(S, iso) {
  for (const id of effectiveRoutineIds(S, iso)) {
    const c = categoryOf(S, S.routines.find(r => r.id === id))
    if (c) return catColor(c)
  }
  return null
}

export function addCategory(s, name, color) {
  const clean = String(name || '').trim()
  if (!clean) return null
  if (!s.categories) s.categories = []
  const cat = { id: uid(), name: clean, color: ACCENTS[color] ? color : 'pink' }
  s.categories.push(cat)
  return cat
}

export function editCategory(s, id, patch) {
  const c = (s.categories || []).find(x => x.id === id)
  if (!c) return
  if (patch.name != null && String(patch.name).trim()) c.name = String(patch.name).trim()
  if (patch.color && ACCENTS[patch.color]) c.color = patch.color
}

/** Delete a category and clear it from every routine that wore it. */
export function deleteCategory(s, id) {
  s.categories = (s.categories || []).filter(c => c.id !== id)
  s.routines.forEach(r => { if (r.cat === id) delete r.cat })
}

export function setRoutineCategory(s, routineId, catId) {
  const r = s.routines.find(x => x.id === routineId)
  if (!r) return
  if (catId && (s.categories || []).some(c => c.id === catId)) r.cat = catId
  else delete r.cat
}
