// Turn Aimharder's workout JSON into a small, stable shape, and decide which class it belongs to.
//
// Field meanings follow what aimharder-mcp (MIT, github.com/rudeayelo/aimharder-mcp) verified against
// a real gym: the intended date is the detail's `recordDate` (a Spanish "14 de Octubre de 2026"),
// never the feed's publication time; `formaReg` says what `valor1` means; `scaledops` lists the
// labelled difficulty levels. Everything we do not understand is kept out, not guessed at.

import { norm, isTrue, num } from './util.mjs'

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const LOAD_UNITS = ['kg', 'lbs', 'pood', '%BW', '%RM', 'RIR', 'RPE']
const DIST_UNITS = ['m', 'mi', 'yd', 'ft', 'steps', 'km']

/** "14 de Octubre de 2026" -> "2026-10-14"; null when it is not that format. */
export function parseRecordDate(text) {
  const m = /^(\d{1,2}) de ([a-z]+) de (\d{4})$/.exec(norm(text))
  if (!m) return null
  const month = m[2] === 'setiembre' ? 8 : MONTHS.indexOf(m[2])
  if (month < 0) return null
  const day = Number(m[1])
  if (day < 1 || day > 31) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const unitIndex = v => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  return Number.isInteger(n) ? n : -1
}

function projectExercise(e) {
  const form = unitIndex(e.formaReg)
  const first = (Array.isArray(e.valor1) ? e.valor1 : []).map(num).filter(v => v != null)
  const loadVal = [e.valor2, e.valor2h, e.valor2m].map(num).find(v => v != null) ?? null
  const loadRaw = form === 4 ? e.tipoud : form === 6 ? e.tipoud2 : undefined
  const out = {
    name: String(e.ejerName ?? '').trim(),
    sourceId: Number.isSafeInteger(num(e.ejerId)) && num(e.ejerId) > 0 ? num(e.ejerId) : null,
    blockIndex: Number.isInteger(num(e.tipoWOD)) ? num(e.tipoWOD) : null,
    values: first,                      // every number in valor1 (can be a per-round list)
    valueUnit: null,
    load: null,
    loadUnit: null,
  }
  if (first.length) {
    if (form === 1) out.valueUnit = 's'
    else if (form === 2 || form === 6) out.valueUnit = DIST_UNITS[unitIndex(e.tipoud)] ?? null
    else if (form === 3 || form === 4) out.valueUnit = 'reps'
    else if (form === 5) out.valueUnit = 'cal'
  }
  if (loadVal != null) {
    out.load = loadVal
    out.loadUnit = LOAD_UNITS[unitIndex(loadRaw)] ?? null
  }
  return out
}

/**
 * Combine a feed post and its detail into one workout record.
 * Returns { ok: false, reason } rather than throwing, so one odd post never hides the others.
 */
export function normalizeWorkout(post, detail) {
  if (!post || typeof post !== 'object' || !detail || typeof detail !== 'object') return { ok: false, reason: 'not-an-object' }
  if (!Array.isArray(detail.TIPOWODs) || !Array.isArray(detail.ejerRate)) return { ok: false, reason: 'missing-blocks' }
  const date = parseRecordDate(detail.recordDate)
  if (!date) return { ok: false, reason: 'unrecognised-date', raw: String(detail.recordDate ?? '') }

  const postBlocks = Array.isArray(post.TIPOWODs) ? post.TIPOWODs : []
  const blocks = detail.TIPOWODs.map((b, index) => ({
    index,
    deleted: isTrue(b?.deleted),
    title: String(b?.title ?? postBlocks[index]?.title ?? '').trim() || null,
    notes: b?.notes == null ? null : String(b.notes),
    type: b?.type ?? null,
    timecap: num(b?.timecap),
    timecapType: b?.timecaptype ?? null,
    rounds: num(b?.rondas),
    levels: Array.isArray(b?.scaledops) ? b.scaledops.map(String) : [],
  }))
  const live = new Set(blocks.filter(b => !b.deleted).map(b => b.index))
  const exercises = detail.ejerRate
    .filter(e => e && (e.tipoWOD == null || live.has(num(e.tipoWOD))))
    .map(projectExercise)
    .filter(e => e.name)

  const titles = [...postBlocks.map(b => b?.title), ...blocks.map(b => b.title)]
    .map(t => String(t ?? '').trim()).filter(Boolean)
  return {
    ok: true,
    workout: {
      sourceId: Number.isSafeInteger(num(post.id)) ? num(post.id) : null,
      date,
      wodClass: post.wodClass == null ? null : String(post.wodClass),
      titles: [...new Set(titles)],
      blocks: blocks.filter(b => !b.deleted),
      exercises,
    },
  }
}

export const DEFAULT_RULES = {
  // A post whose title starts with this is the Hyrox class...
  hyroxTitle: '^\\s*hyrox',
  // ...a post with no title at all is the CrossFit class.
  crossfitIfUntitled: true,
}

/** 'hyrox' | 'crossfit' | 'unclear' — never a guess: anything else is surfaced for a human. */
export function classify(workout, rules = DEFAULT_RULES) {
  const re = new RegExp(rules.hyroxTitle, 'i')
  if (workout.titles.some(t => re.test(norm(t)))) return 'hyrox'
  if (re.test(norm(workout.wodClass ?? ''))) return 'hyrox'
  if (rules.crossfitIfUntitled && workout.titles.length === 0) return 'crossfit'
  return 'unclear'
}

/** Key names (no values) seen in the raw responses: shows what else Aimharder sends. */
export function inventory(objects) {
  const seen = {}
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue
    for (const [k, v] of Object.entries(o)) {
      seen[k] ||= new Set()
      seen[k].add(Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
    }
  }
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v].sort().join('|')]))
}
