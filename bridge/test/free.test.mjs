import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFreeMenu, recommendFree, resolveTitle } from '../src/free.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { targets as loadTargets, selection as loadSel, ROOT } from './helpers.mjs'

const T = loadTargets(), SEL = loadSel()
// Tests never read your own (git-ignored) routines: they use the generic examples.
const EXAMPLES = Object.fromEntries(Object.entries(SEL.free).map(([k, c]) => [k, { ...c, file: 'no-such-file.txt' }]))
const menu = buildFreeMenu(`${ROOT}/config/free`, EXAMPLES)
const S = (kind, t, load, name = `${kind}@${t}`) => ({ kind, t, day: 'x', name, load, stim: load })
const rec = (sessions, extra = {}) => recommendFree({ menu, sessions, targets: extra.targets ?? T, selection: SEL, dates: [], lastFree: extra.lastFree })

test('the free routines become routines with the same exercises, weights from the last loaded set', () => {
  assert.deepEqual(Object.keys(menu).sort(), ['legs', 'upper'])
  const up = menu.upper.routine, legs = menu.legs.routine
  assert.equal(up.ex.length, 9)
  assert.equal(legs.ex.length, 5)
  const lat = up.ex.find(e => e.id === '0673')
  assert.deepEqual([lat.sets, lat.reps, lat.weight], [4, 10, 45])
  const calf = legs.ex.find(e => e.id === '0605')
  assert.equal(calf.weight, 30)                       // not the trailing 0 kg set
  assert.equal(menu.upper.usingExample, true)
  assert.equal(up.excludeFromProgression, undefined)  // free routines DO take part in progression
  assert.deepEqual([menu.upper.unresolved, menu.legs.unresolved], [[], []])
})

test('hip thrust (machine) is not in the library: it becomes a custom exercise that loads the glutes', () => {
  const hip = menu.legs.routine.ex.find(e => e.id === 'ahx-hip-thrust')
  assert.ok(hip)
  assert.equal(hip.sets, 3)
  const c = menu.legs.customEx.find(x => x.id === 'ahx-hip-thrust')
  assert.ok(c.primaries.includes('gluteal'))
  assert.equal(resolveTitle('Totally Unknown Machine'), null)
})

test('back is short and nothing else is going on: the upper routine is recommended', () => {
  const r = rec([S('class', 31, { quadriceps: 8, gluteal: 8 })])
  assert.equal(r.chosen.key, 'upper')
  assert.ok(r.chosen.coverage.find(c => c.slug === 'upper-back').counted > 0)
})

test('upper body is covered by classes and glutes are short: legs is recommended', () => {
  const r = rec([S('class', 31, { 'upper-back': 14, chest: 9, biceps: 9 })])
  assert.equal(r.chosen.key, 'legs')
})

test('a leg class the next day is a clash that counts against the legs routine', () => {
  const quiet = rec([S('class', 31, { chest: 2 })]).options.find(o => o.key === 'legs')
  const clash = rec([S('class', 31, { quadriceps: 10, gluteal: 10, hamstring: 6 }, 'Hyrox')]).options.find(o => o.key === 'legs')
  assert.equal(quiet.penalty, 0)
  assert.ok(clash.penalty > 5, `penalty ${clash.penalty}`)
  assert.ok(clash.clashes.some(c => c.with === 'Hyrox' && c.direction === 'later'))
})

test('Sunday\'s long run counts against a legs session on Monday morning, at half weight', () => {
  const without = rec([]).options.find(o => o.key === 'legs')
  const withRun = rec([S('run', -15, { quadriceps: 5, hamstring: 3, calves: 5, gluteal: 3 }, 'long run')]).options.find(o => o.key === 'legs')
  assert.ok(withRun.penalty > without.penalty)
  assert.ok(withRun.clashes.every(c => c.kind === 'run'))
})

test('with nothing to fill, the routine you did last is not repeated (rotation tie-break)', () => {
  const none = { ...T, targets: {} }
  assert.equal(rec([], { targets: none, lastFree: 'upper' }).chosen.key, 'legs')
  assert.equal(rec([], { targets: none, lastFree: 'legs' }).chosen.key, 'upper')
})

test('add-ons are only suggestions: they name the exercise and a number of sets, and nothing is changed', () => {
  const before = JSON.stringify(menu.upper.routine)
  const r = rec([S('class', 31, { quadriceps: 8 })])
  assert.ok(r.addOns.every(a => a.title && a.extraSets >= 1 && a.extraSets <= 3))
  assert.equal(JSON.stringify(menu.upper.routine), before)
})

test('your own routine file wins over the example, and is what gets read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-'))
  fs.copyFileSync(`${ROOT}/config/free/legs.example.txt`, path.join(dir, 'legs.example.txt'))
  fs.writeFileSync(path.join(dir, 'legs.txt'), 'My legs\nMonday, Jan 1, 2026 at 7:00am\n\nLunge (Barbell)\nSet 1: 50 kg x 8\n')
  const cfg = { legs: { file: 'legs.txt', example: 'legs.example.txt', name: 'Legs', emoji: 'legs' } }
  const m = buildFreeMenu(dir, cfg)
  assert.equal(m.legs.usingExample, false)
  assert.equal(m.legs.routine.ex.length, 1)
  assert.equal(m.legs.routine.ex[0].weight, 50)
  assert.deepEqual(buildFreeMenu(fs.mkdtempSync(path.join(os.tmpdir(), 'free-')), cfg), {})   // neither file: no menu, no crash
})
