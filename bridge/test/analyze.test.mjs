import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkout } from '../src/parse.mjs'
import { buildRoutine } from '../src/routine.mjs'
import { catalogue } from '../src/appbridge.mjs'
import { summarize, effortOf, findOverlaps, totals, gaps, sessionsFor, analyzeWeek, regionOf } from '../src/analyze.mjs'
import { targets as loadTargets, selection as loadSel } from './helpers.mjs'
import { hyroxTue, crossfitWed, hyroxThu } from './fixtures/week.mjs'

const T = loadTargets(), SEL = loadSel()
const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
const cls = (p, c) => { const b = buildRoutine(normalizeWorkout(p.post, p.detail).workout, c, { catalogue }); return { date: b.routine.id.slice(4, 14), cls: c, routine: b.routine, customEx: b.customEx, effort: b.effort, stimulus: b.stimulus } }
const S = (kind, t, load, extra = {}) => ({ kind, t, day: 'x', name: `${kind}@${t}`, load, stim: extra.stim ?? load, ...extra })

test('regions group the app\'s muscles', () => {
  assert.equal(regionOf('gluteal', T), 'legs')
  assert.equal(regionOf('upper-back', T), 'pull')
  assert.equal(regionOf('chest', T), 'push')
  assert.equal(regionOf('abs', T), 'core')
})

test('one-line summary: top regions plus cardio when there is conditioning', () => {
  assert.equal(summarize({ quadriceps: 10, gluteal: 8, 'upper-back': 1 }, { condMinutes: 30 }, T), 'legs + cardio')
  assert.equal(summarize({ quadriceps: 6, 'upper-back': 6, chest: 5 }, { condMinutes: 0 }, T), 'legs + pull')
  assert.equal(summarize({ chest: 8 }, {}, T), 'push')
  assert.equal(summarize({}, {}, T), 'nothing recognised')
})

test('effort label is coarse and driven by strength sets and conditioning minutes', () => {
  assert.equal(effortOf({ strengthSets: 3, condMinutes: 0 }), 'light')
  assert.equal(effortOf({ strengthSets: 5, condMinutes: 12 }), 'moderate')
  assert.equal(effortOf({ strengthSets: 10, condMinutes: 30 }), 'hard')
})

test('overlap uses the app\'s 36 h half-life: 6 sets carried 24 h leave 3.8, carried 72 h leave 1.5', () => {
  const o24 = findOverlaps([S('class', 0, { gluteal: 6 }), S('class', 24, { gluteal: 4 })], T)
  assert.equal(o24.length, 1)
  assert.equal(o24[0].muscles[0].carried, 3.8)
  assert.equal(o24[0].muscles[0].severity, 'high')
  assert.equal(findOverlaps([S('class', 0, { gluteal: 6 }), S('class', 72, { gluteal: 4 })], T).length, 0)   // 1.5 < 2
})

test('no overlap when the later session barely uses the muscle, or the earlier one is small', () => {
  assert.equal(findOverlaps([S('class', 0, { gluteal: 6 }), S('class', 24, { gluteal: 1 })], T).length, 0)
  assert.equal(findOverlaps([S('class', 0, { gluteal: 2 }), S('class', 24, { gluteal: 6 })], T).length, 0)   // 2 × 0.63 = 1.3
})

test('totals count classes and the free workout but never the assumed runs or sessions outside the week', () => {
  const sessions = [S('run', -15, { quadriceps: 3 }), S('free', 7, { chest: 4 }), S('class', 31, { chest: 2 }), S('run', 150, { quadriceps: 3 }), S('class', 200, { chest: 9 })]
  assert.deepEqual(totals(sessions), { chest: 6 })
})

test('gaps are measured against the targets in your config', () => {
  const g = gaps({ 'upper-back': 5, gluteal: 20 }, T)
  const back = g.find(x => x.slug === 'upper-back'), glutes = g.find(x => x.slug === 'gluteal')
  assert.deepEqual([back.label, back.gap], ['back', 7])
  assert.equal(glutes.gap, 0)
})

test('conditioning and cardio sets count less toward targets, but fatigue uses the app\'s full count', () => {
  const sessions = sessionsFor({ dates, classes: [cls(hyroxTue, 'hyrox')], free: null, targets: T, selection: SEL })
  const tue = sessions.find(s => s.kind === 'class')
  assert.ok(tue.stim.gluteal < tue.load.gluteal * 0.5, `stim ${tue.stim.gluteal} vs load ${tue.load.gluteal}`)
  assert.ok(tue.cardio > 0)
  assert.equal(tue.load['cardiovascular system'], undefined)   // the cardio slug is kept apart from muscles
})

test('strength sets are not discounted', () => {
  const wed = sessionsFor({ dates, classes: [cls(crossfitWed, 'crossfit')], free: null, targets: T, selection: SEL }).find(s => s.kind === 'class')
  assert.ok(wed.stim.quadriceps >= wed.load.quadriceps * 0.6)
})

test('the week timeline places sessions in hours from Monday and adds the Sunday run on both sides', () => {
  const sessions = sessionsFor({ dates, classes: [cls(hyroxTue, 'hyrox')], free: null, targets: T, selection: SEL })
  assert.equal(sessions.find(s => s.kind === 'class').t, 24 + 7)
  assert.deepEqual(sessions.filter(s => s.kind === 'run' && s.day === 'sun').map(s => s.t), [-15, 153])
})

test('a full week: summaries, overlaps and gaps come out together', () => {
  const a = analyzeWeek({ dates, classes: [cls(hyroxTue, 'hyrox'), cls(crossfitWed, 'crossfit'), cls(hyroxThu, 'hyrox')], free: null, targets: T, selection: SEL })
  assert.equal(a.days.filter(s => s.kind === 'class').length, 3)
  assert.ok(a.overlaps.some(o => o.from.day === 'tue' && o.to.day === 'wed'))
  assert.equal(a.gapsClassesOnly.length, 4)
})
