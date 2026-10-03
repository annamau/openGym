// Build an openGym routine from one published Aimharder workout.
//
// Rules this file keeps:
//  - Movements are matched against the dictionary; anything unmatched is REPORTED, not invented.
//  - Prescribed loads are written only when they are plain kg/lbs numbers; %RM and "43/30 kg"
//    style pairs stay in the note, because guessing a weight would put a made-up number in your history.
//  - Class routines are flagged excludeFromProgression: the app then neither progresses nor
//    deloads them and they never become the baseline of a regular session.
//  - Set counts for conditioning are estimates (rounds, ladders, AMRAPs); every estimate says how
//    it was derived so it can be corrected.

import { norm, DAY_LONG, prettyDate, weekdayOf, DAYS, round1 } from './util.mjs'
import { matchMovement, readSegment, segmentsOf, isSkippable, resolveEntry } from './movements.mjs'

const LB_TO_KG = 0.45359237

// Lines that describe the format of a block (not a movement): never reported as "not recognised".
const FORMAT_LINE = /^(\d+\s*(rondas?|rounds?|rds)\b|emom\b|amrap\b|e\d+mom\b|for time\b|por tiempo\b|time ?cap\b|cap\b|\d+(\s*[-–]\s*\d+){2,}\b|rest\b|descanso\b|build\b|score\b|nota|note|rx\b|scaled\b)/
export const isFormatLine = text => FORMAT_LINE.test(norm(text).replace(/^[-•*\s]+/, ''))

/** "43/30 kg", "40 kg", "@75%", "24 lb": what the text prescribes, as a note and (only when unambiguous) a weight. */
export function loadHint(text) {
  const t = norm(text)
  let m = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(kg|lbs?|lb)\b/.exec(t)
  if (m) return { note: `${m[1]}/${m[2]} ${m[3]}`, weight: null }
  m = /(?<![\d./])(\d+(?:[.,]\d+)?)\s*(kg|lbs?|lb)\b/.exec(t)
  if (m) {
    const v = Number(m[1].replace(',', '.')), lb = m[2] !== 'kg'
    return { note: `${m[1]} ${m[2]}`, weight: lb ? round1(v * LB_TO_KG) : v }
  }
  m = /(\d+(?:[.,]\d+)?)\s*%/.exec(t)
  if (m) return { note: `${m[1]}%`, weight: null }
  return null
}

export function parseFormat(block) {
  const t = norm(block.notes ?? '')
  const f = { kind: null, minutes: null, rounds: null, ladder: null, sets: null, reps: null, label: '' }
  let m
  if ((m = /amrap\s*(?:de\s*)?(\d+)/.exec(t))) { f.kind = 'amrap'; f.minutes = +m[1]; f.label = `AMRAP ${m[1]}′` }
  else if ((m = /emom\s*(?:de\s*)?(\d+)/.exec(t))) { f.kind = 'emom'; f.minutes = +m[1]; f.label = `EMOM ${m[1]}′` }
  else if ((m = /\b(\d{1,3}(?:\s*[-–]\s*\d{1,3}){2,})\b/.exec(t))) {
    f.kind = 'ladder'; f.ladder = m[1].split(/\s*[-–]\s*/).map(Number); f.label = m[1].replace(/\s+/g, '')
  } else if ((m = /(\d+)\s*[x×]\s*(\d+)/.exec(t))) { f.kind = 'strength'; f.sets = +m[1]; f.reps = +m[2]; f.label = `${m[1]}×${m[2]}` }
  else if ((m = /(\d+)\s*(?:rondas|rounds|rds)\b/.exec(t)) || (block.rounds ? [null, block.rounds] : null)) {
    f.kind = 'rounds'; f.rounds = +m[1]; f.label = `${m[1]} rounds`
  }
  const cap = block.timecap != null ? (block.timecap >= 120 ? block.timecap / 60 : block.timecap)
    : (m = /time ?cap\s*:?\s*(\d+)/.exec(t)) ? +m[1] : null
  f.timecapMin = cap
  if (!f.label && /for time|por tiempo/.test(t)) f.label = 'for time'
  return f
}

function loadKg(ex) {
  if (ex.load == null) return 0
  if (ex.loadUnit === 'kg') return ex.load
  if (ex.loadUnit === 'lbs') return round1(ex.load * LB_TO_KG)
  return 0
}
const loadNote = ex => ex.load == null ? '' : (ex.loadUnit === 'kg' || ex.loadUnit === 'lbs') ? '' : ` ${ex.load}${ex.loadUnit ? ' ' + ex.loadUnit : ''}`

function cardioMinutes(entry, { values, valueUnit, reps, distance, unit }, blockFmt, k) {
  const sec = valueUnit === 's' ? values[0] : null
  if (sec) return round1(sec / 60)
  const km = valueUnit === 'm' && values[0] ? values[0] / 1000 : valueUnit === 'km' && values[0] ? values[0]
    : distance != null ? (unit === 'km' ? distance : unit === 'm' ? distance / 1000 : null) : null
  if (km != null && entry.minPerKm) return round1(km * entry.minPerKm)
  if (valueUnit === 'cal' || unit === 'cal') return round1((values[0] ?? distance ?? 10) / 12)
  if (entry.key === 'double-under' && (values[0] || reps)) return round1((values[0] ?? reps) / 100)
  if (blockFmt.minutes) return round1(blockFmt.minutes / Math.max(1, k))
  return 3
}

export function buildRoutine(workout, cls, { catalogue, amrapRounds = 4 } = {}) {
  const customs = new Map()
  const rows = new Map()           // exercise id -> merged config
  const kindSets = {}              // exercise id -> { strength, conditioning, cardio } sets, for the stimulus discount
  const report = []                // one line per movement found
  const unresolved = []
  let strengthSets = 0, condMinutes = 0, cardioCount = 0

  // Warm-up, mobility and cool-down blocks are not training load; they are listed, not counted.
  const SKIP_BLOCK = /calent|warm|movilidad|mobility|cool ?down|vuelta a la calma|estir|stretch|activaci/
  const skippedBlocks = workout.blocks.filter(b => !b.deleted && SKIP_BLOCK.test(norm(b.title ?? ''))).map(b => b.title)
  const live = workout.blocks.filter(b => !b.deleted && !SKIP_BLOCK.test(norm(b.title ?? '')))
  const groups = live.length ? live : [{ index: -1, notes: null, title: null, rounds: null, timecap: null }]
  const skippedIdx = new Set(workout.blocks.filter(b => !b.deleted && !live.includes(b)).map(b => b.index))
  const loose = workout.exercises.filter(e => e.blockIndex == null || (!live.some(b => b.index === e.blockIndex) && !skippedIdx.has(e.blockIndex)))

  for (const block of groups) {
    const fmt = parseFormat(block)
    const structured = workout.exercises.filter(e => e.blockIndex === block.index).concat(block.index === groups[0].index ? loose : [])
    const found = structured.length
      ? structured.map(e => ({ text: e.name, ex: e }))
      : segmentsOf(block.notes).filter(s => !isSkippable(s) && !isFormatLine(s)).map(s => ({ text: s, ex: null }))
    const k = found.length || 1
    if (fmt.minutes) condMinutes += fmt.minutes
    else if (fmt.timecapMin && fmt.kind !== 'strength') condMinutes += fmt.timecapMin

    for (const { text, ex } of found) {
      const entry = matchMovement(text)
      if (!entry) {
        // A segment that is clearly just prose (no digits and a long sentence) is not a movement.
        if (ex || /\d/.test(text) || text.split(' ').length <= 4) unresolved.push(text.slice(0, 80))
        continue
      }
      const seg = ex
        ? { values: ex.values, valueUnit: ex.valueUnit, reps: ex.valueUnit === 'reps' ? ex.values[0] : null, distance: null, unit: null }
        : { values: [], valueUnit: null, ...readSegment(text) }
      const reps = ex ? seg.reps : seg.reps

      let sets, setsSource
      if (fmt.kind === 'strength') { sets = fmt.sets; setsSource = 'NxM' }
      else if (fmt.kind === 'rounds') { sets = fmt.rounds; setsSource = 'rounds' }
      else if (fmt.kind === 'ladder') { sets = fmt.ladder.length; setsSource = 'ladder' }
      else if (fmt.kind === 'emom') { sets = Math.max(1, Math.ceil(fmt.minutes / k)); setsSource = 'emom' }
      else if (fmt.kind === 'amrap') { sets = amrapRounds; setsSource = 'amrap-estimate' }
      else if (ex && ex.values.length > 1) { sets = ex.values.length; setsSource = 'value-list' }
      else if (entry.strength) { sets = 3; setsSource = 'default' }
      else { sets = 1; setsSource = 'single' }

      const resolved = resolveEntry(entry, catalogue)
      const id = resolved.kind === 'catalogue' ? resolved.id : resolved.custom.id
      if (resolved.kind === 'custom') customs.set(id, resolved.custom)

      const cfg = { id, sets }
      const notes = []
      if (block.title) notes.push(block.title)
      if (fmt.label) notes.push(fmt.label)
      if (entry.mode === 'cardio') {
        cfg.mode = 'cardio'
        cfg.min = cardioMinutes(entry, { ...seg }, fmt, k)
        cfg.speed = 0
        cardioCount++
        if (!fmt.minutes) condMinutes += cfg.min * sets
        notes.push('time is an estimate')
      } else if (entry.mode === 'time') {
        cfg.mode = 'time'
        cfg.sec = ex?.valueUnit === 's' ? ex.values[0] : 30
      } else {
        const r = fmt.kind === 'strength' ? fmt.reps : fmt.kind === 'ladder' ? Math.round(fmt.ladder.reduce((a, b) => a + b, 0) / fmt.ladder.length) : reps
        cfg.reps = r ?? seg.distance ?? 10
        if (seg.distance != null && seg.unit) notes.push(`${seg.distance} ${seg.unit}`)
        else if (ex && ex.valueUnit && ex.valueUnit !== 'reps' && ex.values[0] != null) notes.push(`${ex.values[0]} ${ex.valueUnit}`)
        cfg.weight = ex ? loadKg(ex) : 0
        const ln = ex ? loadNote(ex) : ''
        if (ln) notes.push(ln.trim())
        if (!ex) {
          const hint = loadHint(text)
          if (hint) { notes.push(`prescribed ${hint.note}`); if (hint.weight != null) cfg.weight = hint.weight }
        }
      }
      const kind = entry.mode === 'cardio' ? 'cardio' : (fmt.kind === 'strength' || entry.strength) ? 'strength' : 'conditioning'
      ;(kindSets[id] ||= { strength: 0, conditioning: 0, cardio: 0 })[kind] += sets
      if (kind === 'strength') strengthSets += sets
      // Without a stated duration, a set of loaded conditioning work is counted as about a minute.
      if (kind === 'conditioning' && !fmt.minutes && !fmt.timecapMin) condMinutes += sets
      if (notes.length) cfg.note = notes.join(' · ')

      const prev = rows.get(id)
      if (prev) { prev.sets += sets; if (cfg.note && !(prev.note || '').includes(cfg.note)) prev.note = [prev.note, cfg.note].filter(Boolean).join(' | ') }
      else rows.set(id, cfg)
      report.push({ text: text.slice(0, 60), movement: entry.label, as: resolved.kind === 'catalogue' ? `library: ${resolved.name}` : 'custom', sets, setsSource })
    }
  }

  const d = new Date(workout.date + 'T12:00:00Z').getUTCDay()
  const dayKey = DAYS[(d + 6) % 7]
  const label = cls === 'hyrox' ? 'Hyrox' : 'CrossFit'
  const routine = {
    id: `ahw-${workout.date}-${cls}`,
    name: `${label} · ${DAY_LONG[dayKey]} ${prettyDate(workout.date)}`,
    emoji: cls === 'hyrox' ? 'legs' : 'barbell',
    ex: [...rows.values()],
    excludeFromProgression: true,
    source: 'aimharder',
    sourceId: workout.sourceId,
    wod: live.map(b => ({ title: b.title, notes: b.notes })).filter(b => b.title || b.notes),
  }
  return {
    routine,
    customEx: [...customs.values()],
    movements: report,
    stimulus: kindSets,
    unresolved: [...new Set(unresolved)],
    skippedBlocks,
    effort: { strengthSets, condMinutes: round1(condMinutes), cardioCount },
  }
}
