// Read the text Hevy produces when you "share" a workout, e.g.
//
//   Legs quick routine
//   Monday, Jul 27, 2026 at 7:02am
//
//   Lunge (Barbell)
//   Set 1: 30 kg x 20
//   Set 2: 40 kg x 16 @ 9.5 rpe
//
// so a free-workout routine can be updated by pasting a fresh share into config/free/*.txt.

import { num } from './util.mjs'

const DATE_LINE = /^[A-Za-z]+,\s+[A-Za-z]{3,}\s+\d{1,2},\s+\d{4}/
const stripEmoji = s => s.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim()

export function parseHevyText(text) {
  const out = { name: null, date: null, exercises: [], warnings: [] }
  let cur = null
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('@') || /^https?:\/\//i.test(line)) continue
    // Hevy collapses identical sets into one line: "3 sets 4 kg x 10".
    const collapsed = /^(\d+)\s+sets?\s+(.+)$/i.exec(line)
    const set = collapsed || /^set\s+\d+:\s*(.+)$/i.exec(line)
    if (set) {
      const times = collapsed ? Number(collapsed[1]) : 1
      const body0 = collapsed ? collapsed[2] : set[1]
      if (!cur) { out.warnings.push('set line before any exercise: ' + line); continue }
      const body = body0
      let m = /^([\d.,]+)\s*(kg|lbs?)\s*x\s*(\d+)(?:\s*@\s*([\d.,]+)\s*rpe)?/i.exec(body)
      if (m) {
        for (let i = 0; i < times; i++) cur.sets.push({ weight: num(m[1]) ?? 0, unit: /^l/i.test(m[2]) ? 'lb' : 'kg', reps: Number(m[3]), rpe: m[4] ? num(m[4]) : null })
        continue
      }
      m = /^(\d+)\s*reps?(?:\s*@\s*([\d.,]+)\s*rpe)?/i.exec(body)
      if (m) { for (let i = 0; i < times; i++) cur.sets.push({ weight: 0, unit: 'kg', reps: Number(m[1]), rpe: m[2] ? num(m[2]) : null }); continue }
      out.warnings.push('could not read set: ' + line)
      continue
    }
    if (out.name === null) { out.name = stripEmoji(line); continue }
    if (out.date === null && DATE_LINE.test(line)) { out.date = line; continue }
    cur = { title: line, sets: [] }
    out.exercises.push(cur)
  }
  out.exercises = out.exercises.filter(e => {
    if (e.sets.length) return true
    out.warnings.push('exercise without sets ignored: ' + e.title)
    return false
  })
  return out
}

/**
 * The working set of an exercise: the last set that carries weight (a trailing "0 kg" set is
 * usually bodyweight), else the last set. Initial targets come from it, never from the first
 * (warm-up-ish) sets.
 */
export function workingSet(sets) {
  const loaded = sets.filter(s => s.weight > 0)
  return (loaded.length ? loaded : sets).at(-1)
}
