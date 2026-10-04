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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Aimharder stores workout text as HTML (<br />, &#039;, curly quotes). Everything downstream works on
 * plain text with one line per line.
 */
export function plain(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>|<\/\s*(?:p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[\u2018\u2019\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[ \t\u00A0]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}
const safeChar = n => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')

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
  const rawLoad = e.valor2 == null ? '' : String(e.valor2).trim()
  const out = {
    name: plain(e.ejerName),
    nom: plain(e.tWODnom) || null,       // the block's format name in Aimharder ("Rounds For Time", "EMOM", ...)
    round: num(e.round),
    repeat: num(e.roundrepeat),          // EMOM: number of rounds; "Time Stations": seconds per station
    loadText: rawLoad || null,           // kept verbatim: "20/15" (men/women) is not a number
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
    notes: b?.notes == null ? null : plain(b.notes),
    section: num(b?.sstipo),             // 0 = workout, 1 = strength, 2 = warm-up (as seen in the gym's data)
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
  // A publication is the Hyrox class when one of its blocks starts with this text. In this gym's data
  // the Hyrox publication has a first block that just says "HYROX". A title starting with it counts too.
  hyroxText: '^\\s*hyrox',
  // Any other publication is the CrossFit class. Set to false to see them as "unclear" instead.
  crossfitIfNoMarker: true,
}

/** 'hyrox' | 'crossfit' | 'unclear'. Two publications of the same class on one day are surfaced by the caller, never guessed. */
export function classify(workout, rules = DEFAULT_RULES) {
  const re = new RegExp(rules.hyroxText ?? rules.hyroxTitle ?? DEFAULT_RULES.hyroxText, 'i')
  if ((workout.blocks ?? []).some(b => re.test(norm(b.notes ?? '')))) return 'hyrox'
  if (workout.titles.some(t => re.test(norm(t)))) return 'hyrox'
  if (re.test(norm(workout.wodClass ?? ''))) return 'hyrox'
  return (rules.crossfitIfNoMarker ?? rules.crossfitIfUntitled ?? true) ? 'crossfit' : 'unclear'
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
