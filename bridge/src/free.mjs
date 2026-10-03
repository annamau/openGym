// The one free workout of the week: build the menu from the routines you already do, then score
// each option against the week's gaps and clashes. The routine itself is never rewritten here:
// progression needs the same exercises week after week, so the only extras on offer are
// optional add-on sets, shown as suggestions and never applied on their own.

import fs from 'node:fs'
import path from 'node:path'
import { parseHevyText, workingSet } from './hevy-text.mjs'
import { matchMovement, resolveEntry } from './movements.mjs'
import { catalogue, loadOf, musclesOf, halfLifeDecay, FATIGUE_HALF_LIFE_MS } from './appbridge.mjs'
import { gaps, totals, labelOf } from './analyze.mjs'
import { DAYS, round1 } from './util.mjs'

const HOUR = 3600000

export function resolveTitle(title) {
  const fromHevy = catalogue.byHevyTitle(title)
  if (fromHevy) return { kind: 'catalogue', id: fromHevy.id, name: fromHevy.n }
  const entry = matchMovement(String(title).replace(/\(.*?\)/g, ' '))
  return entry ? resolveEntry(entry, catalogue) : null
}

/** Turn pasted Hevy share texts into routines. Weights come from the last loaded set of each exercise. */
export function buildFreeMenu(dir, freeCfg) {
  const menu = {}
  for (const [key, cfg] of Object.entries(freeCfg)) {
    // Your own routine is a local file (git-ignored, never published); without it the generic example is used.
    let file = path.join(dir, cfg.file), usingExample = false
    if (!fs.existsSync(file) && cfg.example) { file = path.join(dir, cfg.example); usingExample = true }
    if (!fs.existsSync(file)) continue
    const parsed = parseHevyText(fs.readFileSync(file, 'utf8'))
    const ex = [], customEx = new Map(), unresolved = [], startWeights = []
    for (const e of parsed.exercises) {
      const r = resolveTitle(e.title)
      if (!r) { unresolved.push(e.title); continue }
      const id = r.kind === 'catalogue' ? r.id : r.custom.id
      if (r.kind === 'custom') customEx.set(id, r.custom)
      const w = workingSet(e.sets)
      ex.push({ id, sets: e.sets.length, reps: w.reps, weight: w.unit === 'lb' ? round1(w.weight * 0.45359237) : w.weight })
      startWeights.push(`${e.title}: ${e.sets.length}×${w.reps} @ ${w.weight} ${w.unit}`)
    }
    menu[key] = {
      key, source: path.basename(file), usingExample, wantedFile: cfg.file, warnings: parsed.warnings, unresolved, startWeights,
      routine: { id: `ahf-${key}`, name: cfg.name, emoji: cfg.emoji, ex, source: 'aimharder-bridge-free' },
      customEx: [...customEx.values()],
    }
  }
  return menu
}

function clash(optionLoad, optionT, others, scoring, min, direction) {
  const rows = []
  for (const s of others) {
    const hours = direction === 'later' ? s.t - optionT : optionT - s.t
    if (hours <= 0 || hours > scoring.windowHours) continue
    const decay = halfLifeDecay(hours * HOUR, FATIGUE_HALF_LIFE_MS)
    const weight = s.kind === 'run' ? scoring.runWeight : 1
    for (const [slug, v] of Object.entries(direction === 'later' ? optionLoad : s.load)) {
      const mine = optionLoad[slug] ?? 0
      const theirs = s.load[slug] ?? 0
      const carried = (direction === 'later' ? mine : theirs) * decay
      const overlap = Math.min(carried, direction === 'later' ? theirs : mine)
      if (carried >= min && overlap > 0 && (direction === 'later' ? theirs : mine) >= min) {
        rows.push({ slug, with: s.name, kind: s.kind, hours: round1(hours), direction, overlap: round1(overlap * weight) })
      }
    }
  }
  return rows
}

export function recommendFree({ menu, sessions, targets, selection, dates, lastFree }) {
  const scoring = targets.freeScoring
  const min = targets.overlapMinSets ?? 2
  const freeIdx = DAYS.indexOf(selection.freeDay)
  const freeT = freeIdx * 24 + (selection.freeHour ?? 7)
  const fixed = sessions.filter(s => s.kind !== 'free')
  const base = gaps(totals(fixed), targets)
  const gapOf = Object.fromEntries(base.map(g => [g.slug, g.gap]))

  const options = Object.values(menu).map(opt => {
    const load = Object.fromEntries(Object.entries(loadOf(opt.routine, opt.customEx)).filter(([, v]) => v > 0.001).map(([k, v]) => [k, round1(v)]))
    const coverage = Object.entries(targets.targets).map(([slug]) => {
      const give = Math.min(load[slug] ?? 0, gapOf[slug] ?? 0)
      return { slug, label: labelOf(slug, targets), provides: load[slug] ?? 0, gap: gapOf[slug] ?? 0, counted: round1(give), weighted: round1(give * (targets.priority[slug] ?? 0.5)) }
    })
    const gain = round1(coverage.reduce((a, c) => a + c.weighted, 0))
    const clashes = [...clash(load, freeT, fixed, scoring, min, 'later'), ...clash(load, freeT, fixed, scoring, min, 'earlier')]
    const penalty = round1(clashes.reduce((a, c) => a + c.overlap, 0) * scoring.penaltyWeight)
    const rotation = lastFree && lastFree !== opt.key ? scoring.rotationBonus : 0
    return { key: opt.key, name: opt.routine.name, load, coverage, gain, clashes, penalty, rotation, score: round1(gain - penalty + rotation) }
  }).sort((a, b) => b.score - a.score)

  const chosen = options[0] ?? null
  const addOns = chosen ? suggestAddOns({ chosen, gapOf, targets }) : []
  return { options, chosen, addOns, gapsBeforeFree: base, freeDay: selection.freeDay }
}

function suggestAddOns({ chosen, gapOf, targets }) {
  const out = []
  for (const [slug, cfg] of Object.entries(targets.addOns || {})) {
    if (slug.startsWith('_') || !(slug in targets.targets)) continue
    const left = round1((gapOf[slug] ?? 0) - (chosen.load[slug] ?? 0))
    if (left < 2) continue
    const r = resolveTitle(cfg.title)
    if (!r) continue
    const id = r.kind === 'catalogue' ? r.id : r.custom.id
    const per = (r.kind === 'catalogue' ? musclesOf({ id })[slug] : r.custom.primaries.includes(slug) ? 1 : 0) || cfg.perSet || 1
    out.push({ slug, label: labelOf(slug, targets), stillShort: left, title: cfg.title, extraSets: Math.min(3, Math.ceil(left / per)) })
  }
  return out
}
