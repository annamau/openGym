// Week analysis: per-day muscle load, a one-line summary, overlaps between sessions and the
// gap to the weekly targets. Muscle attribution comes from openGym itself (appbridge.mjs); what
// is new here is only the arithmetic across sessions, which uses the app's own fatigue half-life.

import { loadOf, MUSCLES, halfLifeDecay, FATIGUE_HALF_LIFE_MS } from './appbridge.mjs'
import { DAYS, DAY_LONG, addDays, round1 } from './util.mjs'

const HOUR = 3600000
const labelOf = (slug, targets) => targets?.labels?.[slug] || slug.replace(/-/g, ' ')
const sumValues = o => Object.values(o).reduce((a, b) => a + b, 0)

export function regionOf(slug, targets) {
  for (const [region, list] of Object.entries(targets.regions)) if (list.includes(slug)) return region
  return 'other'
}

const CARDIO = 'cardiovascular system'

/** Round, drop zeros and anything that is not one of the app's muscles (the cardio slug is kept apart). */
function clean(load) {
  const out = {}
  for (const [k, v] of Object.entries(load)) if (v > 0.001 && MUSCLES.includes(k)) out[k] = round1(v)
  return out
}

/**
 * Two views of one routine. `load` is the app's own convention (every set counts in full), which is
 * what the app will show once you log it and what fatigue is predicted with. `stim` discounts
 * conditioning and cardio sets, because 5 rounds of wall balls are not 5 heavy sets for glute growth:
 * it is what the weekly targets are measured with.
 */
export function loadsOf(routine, customEx, kindSets, factors) {
  const full = loadOf(routine, customEx)
  let stim = full
  if (kindSets) {
    stim = loadOf({ ...routine, ex: routine.ex.map(e => {
      const k = kindSets[e.id]
      const total = k ? k.strength + k.conditioning + k.cardio : 0
      if (!k || !total) return e
      const eff = k.strength * 1 + k.conditioning * factors.conditioning + k.cardio * factors.cardio
      return { ...e, sets: e.sets * (eff / total) }
    }) }, customEx)
  }
  return { load: clean(full), stim: clean(stim), cardio: round1(full[CARDIO] ?? 0) }
}

/** "legs + cardio", from the muscle regions that carry the load and the conditioning minutes. */
export function summarize(load, effort, targets, cardioSets = 0) {
  const byRegion = {}
  for (const [slug, v] of Object.entries(load)) {
    const r = regionOf(slug, targets)
    byRegion[r] = (byRegion[r] || 0) + v
  }
  const total = sumValues(byRegion)
  const regions = Object.entries(byRegion).filter(([, v]) => total && v / total >= 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r)
  const cardio = (effort?.condMinutes ?? 0) >= 15 || (effort?.cardioCount ?? 0) >= 2 || cardioSets >= 2
  const parts = [...regions, ...(cardio ? ['cardio'] : [])]
  return parts.length ? parts.join(' + ') : 'nothing recognised'
}

/** Deliberately rough, and labelled as such wherever it is shown. */
export function effortOf(effort) {
  const { strengthSets = 0, condMinutes = 0 } = effort || {}
  const score = strengthSets * 1 + condMinutes * 0.8
  return score >= 30 ? 'hard' : score >= 14 ? 'moderate' : 'light'
}

/** Sessions of the week on one timeline, in hours from Monday 00:00 of the week. */
export function sessionsFor({ dates, classes, free, targets, selection }) {
  const sessions = []
  const idx = iso => dates.indexOf(iso)
  for (const c of classes) {
    const i = idx(c.date)
    const { load, stim, cardio } = loadsOf(c.routine, c.customEx, c.stimulus, targets.stimulusFactors)
    sessions.push({
      kind: 'class', cls: c.cls, date: c.date, day: DAYS[i], t: i * 24 + (selection.classHour ?? 7),
      name: c.routine.name, load, stim, cardio, effort: c.effort, summary: summarize(load, c.effort, targets, cardio), rough: effortOf(c.effort),
    })
  }
  if (free) {
    const i = idx(free.date)
    const { load } = loadsOf(free.routine, free.customEx)
    sessions.push({ kind: 'free', date: free.date, day: DAYS[i], t: i * 24 + (selection.freeHour ?? 7), name: free.routine.name, load, stim: load, cardio: 0, effort: { strengthSets: free.routine.ex.reduce((a, e) => a + e.sets, 0), condMinutes: 0 }, summary: summarize(load, {}, targets), rough: 'planned' })
  }
  for (const [day, run] of Object.entries(targets.runs || {})) {
    if (day.startsWith('_')) continue
    const dayIdx = DAYS.indexOf(day)
    const pattern = targets.runLoad?.[run.kind]
    if (dayIdx < 0 || !pattern) continue
    // Sunday exists twice on the timeline: the one that ended last week and the one that ends this one.
    const offsets = day === 'sun' ? [-1, 6] : [dayIdx]
    for (const i of offsets) sessions.push({
      kind: 'run', date: addDays(dates[0], i), day, t: i * 24 + (run.hour ?? 9), name: `${run.kind} run (assumed)`,
      load: clean(pattern), stim: {}, cardio: 0, effort: { strengthSets: 0, condMinutes: 0 }, summary: 'legs (run)', rough: run.kind,
    })
  }
  return sessions.sort((a, b) => a.t - b.t)
}

/** Pairs of sessions where a muscle is still carrying the earlier session's fatigue into the later one. */
export function findOverlaps(sessions, targets) {
  const min = targets.overlapMinSets ?? 2
  const high = targets.overlapHighSets ?? 3.5
  const found = []
  for (let b = 0; b < sessions.length; b++) {
    for (let a = 0; a < b; a++) {
      const A = sessions[a], B = sessions[b]
      const hours = B.t - A.t
      if (hours <= 0 || hours > 72) continue
      if (A.kind === 'run' && B.kind === 'run') continue
      // Anything before Monday only matters as fatigue carried in; we do not plan it.
      const decay = halfLifeDecay(hours * HOUR, FATIGUE_HALF_LIFE_MS)
      const muscles = []
      for (const [slug, loadA] of Object.entries(A.load)) {
        const loadB = B.load[slug] ?? 0
        const carried = loadA * decay
        if (loadB >= min && carried >= min) muscles.push({ slug, carried: round1(carried), earlier: loadA, later: loadB, severity: carried >= high ? 'high' : 'moderate' })
      }
      if (muscles.length) found.push({ from: A, to: B, hours: round1(hours), muscles: muscles.sort((x, y) => y.carried - x.carried) })
    }
  }
  return found
}

// Runs are an assumption (config), so they count as fatigue but never as progress toward a target.
export function totals(sessions) {
  const t = {}
  for (const s of sessions) {
    if (s.kind === 'run' || s.t < 0 || s.t >= 168) continue
    for (const [k, v] of Object.entries(s.stim ?? s.load)) t[k] = round1((t[k] || 0) + v)
  }
  return t
}

export function gaps(total, targets) {
  return Object.entries(targets.targets).map(([slug, target]) => {
    const have = total[slug] ?? 0
    return { slug, label: labelOf(slug, targets), target, have: round1(have), gap: round1(Math.max(0, target - have)) }
  })
}

export function analyzeWeek(input) {
  const { targets } = input
  const sessions = sessionsFor(input)
  const inWeek = sessions.filter(s => s.t >= 0 && s.t < 168)
  const overlaps = findOverlaps(sessions, targets)
  const total = totals(sessions)
  return {
    sessions, days: inWeek, overlaps, total,
    gapsClassesOnly: gaps(totals(sessions.filter(s => s.kind !== 'free')), targets),
    gapsWithAll: gaps(total, targets),
  }
}

export { labelOf, DAY_LONG }
