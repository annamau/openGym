// Which classes you attend this week, and which published workout belongs to each.

import { DAYS, addDays, weekdayOf } from './util.mjs'
import { classify, normalizeWorkout } from './parse.mjs'

/** Monday-first: { mon: '2026-10-05', ... } for the week starting on `mondayIso`. */
export function weekDates(mondayIso) {
  return Object.fromEntries(DAYS.map((d, i) => [d, addDays(mondayIso, i)]))
}

const CLASSES = new Set(['hyrox', 'crossfit'])

/** "tue=hyrox,wed=crossfit" -> { tue: 'hyrox', wed: 'crossfit' } (throws on anything unclear). */
export function parseSelect(text) {
  const out = {}
  for (const part of String(text).split(',').map(s => s.trim()).filter(Boolean)) {
    const [d, c] = part.split('=').map(s => s.trim().toLowerCase())
    if (!DAYS.includes(d) || !CLASSES.has(c)) throw new Error(`cannot read "${part}" — use day=class, e.g. tue=hyrox,wed=crossfit`)
    out[d] = c
  }
  return out
}

/**
 * Selection precedence: an explicit --select replaces everything; otherwise the defaults,
 * minus any --skip days, plus any --add days.
 */
export function applySelection(defaults, { select, skip = [], add } = {}) {
  if (select) return { ...select }
  const sel = { ...defaults }
  for (const d of skip) delete sel[String(d).toLowerCase()]
  return { ...sel, ...(add || {}) }
}

/**
 * For every selected (day, class), find the published workout. Exactly one match is "ok";
 * none is "missing" (not published yet, or not on the first feed page); several is "ambiguous".
 * It never picks between candidates: a human decides.
 */
export function resolveWeek(workouts, selection, dates, rules) {
  return DAYS.filter(d => selection[d]).map(day => {
    const date = dates[day], cls = selection[day]
    const same = workouts.filter(w => w.date === date)
    const candidates = same.filter(w => classify(w, rules) === cls)
    if (candidates.length === 1) return { day, date, cls, status: 'ok', workout: candidates[0] }
    if (candidates.length > 1) return { day, date, cls, status: 'ambiguous', candidates }
    const unclear = same.filter(w => classify(w, rules) === 'unclear')
    return { day, date, cls, status: 'missing', unclear }
  })
}

/** Is this publication one of the classes you attend? Judged by its weekday and its class, whatever the week. */
export function isSelected(workout, selection, rules) {
  const day = DAYS[(weekdayOf(workout.date) + 6) % 7]
  return selection[day] != null && selection[day] === classify(workout, rules)
}

/**
 * Keep only the raw publications ({post, detail}) of selected classes. Everything else, including
 * publications that cannot be read, is dropped, so nothing about days or classes you do not attend is stored.
 */
export function pruneItems(items, selection, rules) {
  const kept = []
  for (const it of items || []) {
    const n = normalizeWorkout(it?.post, it?.detail)
    if (n.ok && isSelected(n.workout, selection, rules)) kept.push(it)
  }
  return { kept, dropped: (items || []).length - kept.length }
}
