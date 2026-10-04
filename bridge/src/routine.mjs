// Build an openGym routine from one published Aimharder workout.
//
// Rules this file keeps:
//  - Movements are matched against the dictionary; anything unmatched is REPORTED, not invented.
//  - Prescribed loads are written only when they are plain kg/lbs numbers; "20/15", %RM and RPE
//    stay in the note, because guessing a weight would put a made-up number in your plan.
//  - Class routines are flagged excludeFromProgression: the app then neither progresses nor
//    deloads them and they never become the baseline of a regular session.
//  - Warm-up blocks (Aimharder's own warm-up section) and the "HYROX" marker block are not counted.
//  - Set counts for conditioning are estimates (rounds, ladders, AMRAPs); every estimate says how
//    it was derived so it can be corrected.
//
// Two sources are read, in this order: the structured exercise list the gym filled in (names, reps,
// distances, loads, rounds), and, for blocks that only have free text, the text itself.

import { norm, DAY_LONG, prettyDate, DAYS, round1 } from './util.mjs'
import { matchMovement, readSegment, segmentsOf, isSkippable, resolveEntry } from './movements.mjs'

const LB_TO_KG = 0.45359237
const SKIP_BLOCK_TITLE = /calent|warm|movilidad|mobility|cool ?down|vuelta a la calma|estir|stretch|activaci/

// Lines that describe the format of a block (not a movement): never reported as "not recognised".
const FORMAT_LINE = /^(\d+\s*(rondas?|rounds?|rds)\b|\d+\s*rft\b|emom\b|amrap\b|e\d+mom\b|for time\b|por tiempo\b|time ?cap\b|cap\b|\d+(\s*[-–]\s*\d+){2,}\b|rest\b|descanso\b|build\b|score\b|nota|note|rx\b|scaled\b|hyrox\s*$|open\b|metcon\b|evento \d|por parejas|partners?\b|en equipos?\b|del \d+'? al \d+|en \d+'|cambio cada|todo repartido|en la \d+a ronda|\d+ series de cada|\d+\s*min(utos?)?\b.*(rapido|ritmo|lento|on|off)|\d+\s*seg\b|izda\b|dcha\b|d ?= ?\d|\d+\/\d+\)|\d+\s*kg$)|:\s*$/
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

/** Format read from a block's free text: strength NxM, rounds, EMOM, AMRAP, ladders, time cap. */
export function parseFormat(block) {
  const t = norm(block.notes ?? '')
  const f = { kind: null, minutes: null, rounds: null, ladder: null, sets: null, reps: null, label: '', timecapMin: null }
  let m
  if ((m = /amrap\s*(?:de\s*)?(\d+)/.exec(t))) { f.kind = 'amrap'; f.minutes = +m[1]; f.label = `AMRAP ${m[1]}′` }
  else if ((m = /emom\s*(?:de\s*)?(\d+)/.exec(t))) { f.kind = 'emom'; f.minutes = +m[1]; f.label = `EMOM ${m[1]}′` }
  else if ((m = /\b(\d{1,3}(?:\s*[-–]\s*\d{1,3}){2,})\b/.exec(t))) {
    f.kind = 'ladder'; f.ladder = m[1].split(/\s*[-–]\s*/).map(Number); f.label = m[1].replace(/\s+/g, '')
  } else if ((m = /(\d+)\s*[x×]\s*(\d+)/.exec(t))) { f.kind = 'strength'; f.sets = +m[1]; f.reps = +m[2]; f.label = `${m[1]}×${m[2]}` }
  else if ((m = /(\d+)\s*(?:rondas|rounds|rds)\b/.exec(t)) || (m = block.rounds ? [null, block.rounds] : null)) {
    f.kind = 'rounds'; f.rounds = +m[1]; f.label = `${m[1]} rounds`
  }
  // Only a time cap written in the text counts: the numeric timecap field is a code whose meaning is not known.
  if ((m = /time ?cap\s*:?\s*(\d+)/.exec(t))) f.timecapMin = +m[1]
  if (!f.label && /for time|por tiempo/.test(t)) f.label = 'for time'
  return f
}

/** Format read from the block's title and the format name the gym attached to its exercises ("3 RFT", "EMOM", ...). */
export function blockKind(block, nom) {
  const t = norm(block.title ?? ''), n = norm(nom ?? '')
  const out = { kind: null, rounds: null, minutes: null, label: '', odd: null }
  let m
  if (/time stations/.test(n) || /^estaciones/.test(t)) { out.kind = 'stations'; out.label = 'stations' }
  else if (/ladder/.test(n) || /ladder/.test(t)) {
    out.kind = 'ladder'; out.label = 'ladder'
    if ((m = /(\d+)\s*'?\s*amrap/.exec(t))) out.minutes = +m[1]
  } else if (/amrap/.test(n) || /amrap/.test(t)) {
    out.kind = 'amrap'
    if ((m = /(\d+)\s*'?\s*amrap/.exec(t))) { out.minutes = +m[1]; out.label = `AMRAP ${m[1]}′` } else out.label = 'AMRAP'
  } else if (/emom/.test(n) || /^emom/.test(t)) { out.kind = 'emom'; out.label = 'EMOM' }
  else if (/rounds for time/.test(n) || /\brft\b/.test(t)) {
    out.kind = 'rft'
    if ((m = /(\d+)\s*rft/.exec(t))) {
      if (+m[1] <= 12) { out.rounds = +m[1]; out.label = `${m[1]} RFT` } else out.odd = block.title
    }
  } else if (/for time/.test(n) || /for time/.test(t)) { out.kind = 'fortime'; out.label = 'for time' }
  else if (/libre|tecnica/.test(n) || /^open$|tecnica/.test(t)) { out.kind = 'libre'; out.label = block.title || '' }
  return out
}

function loadKg(ex) {
  if (ex.load == null) return 0
  if (ex.loadUnit === 'kg') return ex.load
  if (ex.loadUnit === 'lbs') return round1(ex.load * LB_TO_KG)
  return 0
}

/** Loads that are not a plain kg/lb number stay readable in the note: "20/15 kg", "60 %RM", "RPE 7". */
function loadNote(ex) {
  const raw = ex.loadText ?? (ex.load != null ? String(ex.load) : null)
  if (raw == null) return ''
  if (ex.load != null && (ex.loadUnit === 'kg' || ex.loadUnit === 'lbs')) return ''
  const unit = ex.loadUnit
  if (unit === 'RPE' || unit === 'RIR') return `${unit} ${raw}`
  return unit ? `${raw} ${unit}` : `load ${raw}`     // "20/15" men/women, written without a unit
}

/** A unit written in the name: "Row (m)", "SkiErg (cal)". */
function unitFromName(name) {
  const m = /\(\s*(m|km|cal|cals)\s*\)/i.exec(name)
  return m ? ({ m: 'm', km: 'km', cal: 'cal', cals: 'cal' })[m[1].toLowerCase()] : null
}

function cardioMinutes(entry, seg, blockMinutesPerMove) {
  const { values, valueUnit, reps, distance, unit } = seg
  if (valueUnit === 's' && values[0]) return round1(values[0] / 60)
  const km = valueUnit === 'm' && values[0] ? values[0] / 1000 : valueUnit === 'km' && values[0] ? values[0]
    : distance != null ? (unit === 'km' ? distance : unit === 'm' ? distance / 1000 : null) : null
  if (km != null && entry.minPerKm) return round1(km * entry.minPerKm)
  if (valueUnit === 'cal' || unit === 'cal') return round1((values[0] ?? distance ?? 10) / 12)
  if (entry.key === 'double-under' && (values[0] || reps)) return round1((values[0] ?? reps) / 100)
  if (blockMinutesPerMove) return round1(blockMinutesPerMove)
  return 3
}

/**
 * The gym's EMOM "repeat" is the number of rounds in most blocks (5 rounds of 3 movements = 15 minutes), but
 * some blocks carry the total minutes instead (25 with 5 movements, 40 with 4). A block longer than 36 minutes
 * is not plausible inside an hour-long class, so then the number is read as minutes.
 */
export function emomShape(repeat, movements) {
  const k = Math.max(1, movements)
  if (k === 1 || repeat * k <= 36) return { rounds: repeat, minutes: repeat * k, asMinutes: false }
  return { rounds: Math.max(1, Math.round(repeat / k)), minutes: repeat, asMinutes: true }
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length
/** Rounds of an AMRAP are not published, so: about 1.5 minutes per movement per round, kept between 2 and 10. */
const amrapRounds = (minutes, movements) => Math.min(10, Math.max(2, Math.round((minutes ?? 8) / (1.5 * Math.max(1, movements)))))

/**
 * Free text -> sections, each with its own format. A header line ("10 Rounds For Time", "21-15-9",
 * "EMOM 12") applies to the movement lines under it until the next header; "5x5 Back Squat" applies to itself.
 * Coach remarks (lines starting with * or "(", or long sentences) are not movements.
 */
export function textSections(notes) {
  const keep = seg => !isSkippable(seg) && !isFormatLine(seg)
  const sections = []
  let cur = { fmt: parseFormat({ notes: '' }), segs: [] }
  const close = () => { if (cur.segs.length) sections.push(cur) }
  for (const raw of String(notes ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^[*(]/.test(line) || line.length > 90) continue
    const f = parseFormat({ notes: line })
    const segs = segmentsOf(line)
    const hasMove = segs.some(sg => matchMovement(sg))
    if (f.kind === 'strength') { if (hasMove) { close(); sections.push({ fmt: f, segs: segs.filter(keep) }); cur = { fmt: cur.fmt, segs: [] } } continue }
    if (f.kind) {                                   // a new header, possibly with its movements on the same line
      close()
      cur = { fmt: f, segs: hasMove ? segs.filter(keep) : [] }
      continue
    }
    cur.segs.push(...segs.filter(keep))
  }
  close()
  return sections
}

export function buildRoutine(workout, cls, { catalogue } = {}) {
  const customs = new Map()
  const rows = new Map()           // exercise id -> merged config
  const kindSets = {}              // exercise id -> { strength, conditioning, cardio } sets, for the stimulus discount
  const report = []                // one line per movement found
  const unresolved = []
  const skippedBlocks = []
  let strengthSets = 0, condMinutes = 0, cardioCount = 0

  const marker = b => /^hyrox\s*$/.test(norm(b.notes ?? ''))
  const warmup = b => b.section === 2 || SKIP_BLOCK_TITLE.test(norm(b.title ?? ''))
  const live = []
  for (const b of workout.blocks.filter(x => !x.deleted)) {
    if (marker(b)) continue
    if (warmup(b)) { skippedBlocks.push(b.title || 'warm-up block'); continue }
    live.push(b)
  }
  const noteDone = new Set()
  const liveIdx = new Set(live.map(b => b.index))
  const skippedIdx = new Set(workout.blocks.filter(b => !b.deleted && !liveIdx.has(b.index)).map(b => b.index))
  const groups = live.length ? live : []
  const looseOwner = groups[0]?.index
  const loose = workout.exercises.filter(e => e.blockIndex == null || (!liveIdx.has(e.blockIndex) && !skippedIdx.has(e.blockIndex)))

  // A unit is what shares one format: a structured block, or one section of a free-text block.
  const units = []
  for (const block of groups) {
    const structured = workout.exercises.filter(e => e.blockIndex === block.index).concat(block.index === looseOwner ? loose : [])
      .filter(e => e.nom !== 'Texto libre')
    const blockFmt = parseFormat(block)
    if (structured.length) {
      const kindInfo = blockKind(block, structured.find(e => e.nom)?.nom)
      const found = structured.map(e => ({ text: e.name, ex: e }))
      const k = found.length
      let blockMinutes = null
      if (kindInfo.kind === 'emom') {
        const rep = Math.max(0, ...structured.map(e => e.repeat ?? 0))
        if (rep) blockMinutes = emomShape(rep, k).minutes
      } else if (kindInfo.kind === 'amrap' || kindInfo.kind === 'ladder') blockMinutes = kindInfo.minutes
      units.push({ block, found, kindInfo, textFmt: blockFmt, k, blockMinutes })
    } else {
      const kindInfo = blockKind(block, null)
      const sections = textSections(block.notes)
      sections.forEach((sec, i) => {
        const found = sec.segs.map(sg => ({ text: sg, ex: null }))
        let blockMinutes = sec.fmt.minutes ?? null
        if (blockMinutes == null && i === 0 && !sections.some(x => x.fmt.minutes)) blockMinutes = blockFmt.timecapMin   // a written time cap, counted once
        units.push({ block, found, kindInfo, textFmt: sec.fmt, k: found.length || 1, blockMinutes })
      })
    }
  }

  for (const { block, found, kindInfo, textFmt, k, blockMinutes } of units) {
    if (blockMinutes) condMinutes += blockMinutes
    const perMove = blockMinutes ? blockMinutes / k : null

    for (const { text, ex } of found) {
      const entry = matchMovement(text)
      if (!entry) {
        if (!isSkippable(text) && !isFormatLine(text) && (ex || /\d/.test(text) || text.split(' ').length <= 4)) unresolved.push(text.slice(0, 80))
        continue
      }
      // What one set is made of: reps, a distance, calories or seconds.
      const fromName = ex ? unitFromName(ex.name) : null
      const seg = ex
        ? { values: ex.values, valueUnit: fromName && ex.valueUnit === 'reps' ? fromName : ex.valueUnit, reps: ex.valueUnit === 'reps' && !fromName ? ex.values[0] ?? null : null, distance: null, unit: null }
        : { values: [], valueUnit: null, ...readSegment(text) }

      // How many sets, and why (every guess says so in the report).
      const vals = ex ? ex.values : []
      let sets, setsSource
      const kind = ex ? kindInfo.kind : textFmt.kind
      if (ex) {
        if (kind === 'stations') { sets = ex.round && ex.round > 0 ? ex.round : 1; setsSource = 'stations' }
        else if (kind === 'rft') { sets = kindInfo.rounds ?? 1; setsSource = kindInfo.rounds ? 'rounds' : 'single' }
        else if (kind === 'emom') {
          if (ex.repeat) { const sh = emomShape(ex.repeat, k); sets = sh.rounds; setsSource = sh.asMinutes ? 'emom-estimate' : 'emom' } else { sets = 1; setsSource = 'single' }
        }
        else if (kind === 'amrap') { sets = amrapRounds(kindInfo.minutes, k); setsSource = 'amrap-estimate' } else if (vals.length > 1) { sets = vals.length; setsSource = 'value-list' }
        else if (kind === 'ladder') { sets = 3; setsSource = 'amrap-estimate' }
        else if (kind === 'libre') { sets = 3; setsSource = 'default' }
        else { sets = 1; setsSource = 'single' }
      } else if (textFmt.kind === 'strength') { sets = textFmt.sets; setsSource = 'NxM' }
      else if (textFmt.kind === 'rounds') { sets = textFmt.rounds; setsSource = 'rounds' }
      else if (textFmt.kind === 'ladder') { sets = textFmt.ladder.length; setsSource = 'ladder' }
      else if (textFmt.kind === 'emom') { sets = Math.max(1, Math.ceil(textFmt.minutes / k)); setsSource = 'emom' }
      else if (textFmt.kind === 'amrap') { sets = amrapRounds(textFmt.minutes, k); setsSource = 'amrap-estimate' }
      else if (entry.strength) { sets = 3; setsSource = 'default' }
      else { sets = 1; setsSource = 'single' }

      const resolved = resolveEntry(entry, catalogue)
      const id = resolved.kind === 'catalogue' ? resolved.id : resolved.custom.id
      if (resolved.kind === 'custom') customs.set(id, resolved.custom)

      const cfg = { id, sets }
      const notes = []
      const label = kindInfo.label || textFmt.label
      if (block.title && norm(block.title) !== norm(label)) notes.push(block.title)
      if (label) notes.push(label)
      if (ex && !noteDone.has(block.index)) {          // what the coach wrote on the block, once per block
        noteDone.add(block.index)
        const bn = (block.notes ?? '').replace(/\n+/g, ' / ')
        if (bn && bn.length <= 90 && !marker(block)) notes.push(bn)
      }
      if (kindInfo.odd) notes.push(`odd title "${kindInfo.odd}"`)
      const sectionIsStrength = block.section === 1 || kind === 'libre' || textFmt.kind === 'strength'
      const stimulusKind = entry.mode === 'cardio' ? 'cardio' : (sectionIsStrength || entry.strength) ? 'strength' : 'conditioning'

      if (entry.mode === 'cardio') {
        cfg.mode = 'cardio'
        cfg.speed = 0
        if (kind === 'stations' && ex?.repeat) cfg.min = round1((ex.repeat <= 5 ? ex.repeat * 60 : ex.repeat) / 60)
        else cfg.min = cardioMinutes(entry, seg, perMove)
        cardioCount++
        if (!blockMinutes) condMinutes += cfg.min * sets
        notes.push('time is an estimate')
      } else if (entry.mode === 'time' || kind === 'stations') {
        cfg.mode = 'time'
        const rr = ex?.repeat
        cfg.sec = kind === 'stations' && rr ? (rr <= 5 ? rr * 60 : rr) : ex?.valueUnit === 's' && ex.values[0] ? ex.values[0] : 30
        if (kind === 'stations' && !blockMinutes) condMinutes += (cfg.sec / 60) * sets
      } else {
        let reps
        if (ex && vals.length > 1) {
          const same = vals.every(v => v === vals[0])
          reps = same ? vals[0] : Math.round(mean(vals))
          if (!same) notes.push(`reps ${vals.join('-')}`)
        } else if (kind === 'strength' || textFmt.kind === 'strength') reps = textFmt.reps ?? seg.reps
        else if (textFmt.kind === 'ladder' && !ex) {
          reps = Math.round(mean(textFmt.ladder))
        } else reps = seg.reps
        const distance = ex ? (['m', 'km', 'cal'].includes(seg.valueUnit) ? ex.values[0] : null) : seg.distance
        const dunit = ex ? seg.valueUnit : seg.unit
        cfg.reps = reps ?? distance ?? 10
        if (distance != null && dunit) notes.push(`${distance} ${dunit}`)
        cfg.weight = ex ? loadKg(ex) : 0
        const ln = ex ? loadNote(ex) : ''
        if (ln) notes.push(ln)
        if (!ex) {
          const hint = loadHint(text)
          if (hint) { notes.push(`prescribed ${hint.note}`); if (hint.weight != null) cfg.weight = hint.weight }
        }
        if (stimulusKind === 'conditioning' && !blockMinutes) condMinutes += sets   // about a minute per set
      }
      if (stimulusKind === 'strength') strengthSets += sets
      ;(kindSets[id] ||= { strength: 0, conditioning: 0, cardio: 0 })[stimulusKind] += sets
      if (setsSource.endsWith('estimate') || setsSource === 'default') notes.push('sets estimated')
      if (notes.length) cfg.note = notes.join(' · ')

      const prev = rows.get(id)
      if (prev) {
        if (prev.reps != null && cfg.reps != null && prev.mode == null && cfg.mode == null) {
          prev.reps = Math.round((prev.sets * prev.reps + sets * cfg.reps) / (prev.sets + sets))   // keep sets × reps = total reps
        }
        prev.sets += sets
        if (cfg.note) {                                     // union of the note pieces, in order, without repeats
          const have = (prev.note || '').split(' · ').filter(Boolean)
          prev.note = [...have, ...cfg.note.split(' · ').filter(x => !have.includes(x))].join(' · ')
        }
      } else rows.set(id, cfg)
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
  }
  return {
    routine,
    customEx: [...customs.values()],
    movements: report,
    unresolved: [...new Set(unresolved)],
    skippedBlocks,
    stimulus: kindSets,
    effort: { strengthSets, condMinutes: round1(condMinutes), cardioCount },
  }
}
