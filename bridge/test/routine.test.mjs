import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkout } from '../src/parse.mjs'
import { buildRoutine, parseFormat, isFormatLine, loadHint } from '../src/routine.mjs'
import { matchMovement, readSegment } from '../src/movements.mjs'
import { catalogue, loadOf } from '../src/appbridge.mjs'
import { hyroxTue, crossfitTue, crossfitWed, hyroxThu, crossfitThu, structured, pub } from './fixtures/week.mjs'

const build = (p, cls) => buildRoutine(normalizeWorkout(p.post, p.detail).workout, cls, { catalogue })
const byId = (r, id) => r.routine.ex.find(e => e.id === id)

test('movements are recognised in Spanish and English', () => {
  for (const [text, key] of [
    ['Sentadilla trasera', 'back-squat'], ['Back Squat', 'back-squat'], ['Peso muerto', 'deadlift'], ['Dominadas', 'pull-up'],
    ['Pull-ups', 'pull-up'], ['Zancadas con saco de arena', 'sandbag-lunge'], ['Wall Balls', 'wall-ball'], ['Burpee Broad Jump', 'burpee-broad-jump'],
    ['Hip Thrust (Machine)', 'hip-thrust'], ['Remo en máquina', 'rower'], ['Remo con barra', 'strength-row'], ['500m Row', 'rower'],
  ]) assert.equal(matchMovement(text)?.key, key, text)
  assert.equal(matchMovement('Tomar agua y estirar'), null)
})

test('the more specific movement wins (burpee broad jump is not a plain burpee, sandbag lunge is not a lunge)', () => {
  assert.equal(matchMovement('15 Burpee Broad Jump').key, 'burpee-broad-jump')
  assert.equal(matchMovement('12 Sandbag Lunges').key, 'sandbag-lunge')
  assert.equal(matchMovement('Front Squat').key, 'front-squat')
})

test('reps and distances are read from a line', () => {
  assert.deepEqual(readSegment('20 Wall Ball'), { reps: 20, distance: null, unit: null })
  assert.deepEqual(readSegment('600m Run'), { reps: null, distance: 600, unit: 'm' })
  assert.deepEqual(readSegment('1.5 km Run'), { reps: null, distance: 1.5, unit: 'km' })
})

test('format parsing: strength NxM, rounds, EMOM, AMRAP, ladders, time cap', () => {
  const f = notes => parseFormat({ notes })
  assert.deepEqual([f('5x5 Back Squat').kind, f('5x5 Back Squat').sets, f('5x5 Back Squat').reps], ['strength', 5, 5])
  assert.equal(f('5 rondas\n600m Run').rounds, 5)
  assert.equal(f('EMOM 12').minutes, 12)
  assert.equal(f('AMRAP 30').minutes, 30)
  assert.deepEqual(f('21-15-9\nThruster').ladder, [21, 15, 9])
  assert.equal(f('For time\nTime cap 12').timecapMin, 12)
})

test('format lines are not movements; prose is not reported as a movement either', () => {
  for (const l of ['EMOM 12', '5 rondas', '21-15-9', 'For time (cap 12)', 'Time cap 12', 'AMRAP 30', 'Descanso 2 min']) assert.ok(isFormatLine(l), l)
  for (const l of ['20 Wall Ball', 'Run 600m', 'Thruster']) assert.ok(!isFormatLine(l), l)
})

test('loads in text: a pair is a note only, a single number is a weight, a percentage is a note', () => {
  assert.deepEqual(loadHint('Thruster (43/30 kg)'), { note: '43/30 kg', weight: null })
  assert.deepEqual(loadHint('Front squat 60 kg'), { note: '60 kg', weight: 60 })
  assert.equal(loadHint('Deadlift @75%').weight, null)
  assert.equal(loadHint('Deadlift @75%').note, '75%')
  assert.equal(loadHint('20 Wall Ball'), null)
  assert.equal(loadHint('Press 100 lb').weight, 45.4)
})

test('Hyrox Tuesday: warm-up skipped, rounds become sets, distances kept in the note', () => {
  const b = build(hyroxTue, 'hyrox')
  assert.deepEqual(b.skippedBlocks, ['Hyrox Calentamiento'])
  assert.deepEqual(b.unresolved, [])
  assert.equal(b.routine.id, 'ahw-2026-10-06-hyrox')
  assert.equal(b.routine.name, 'Hyrox · Tue 6 Oct')
  assert.equal(b.routine.excludeFromProgression, true)
  assert.equal(b.routine.ex.length, 4)
  assert.ok(b.routine.ex.every(e => e.sets === 5))
  assert.match(byId(b, 'ahx-sled-push').note, /25 m/)
  assert.equal(byId(b, 'ahx-run').mode, 'cardio')
  assert.equal(byId(b, 'ahx-run').min, 3.3)       // 0.6 km at 5.5 min/km, flagged as an estimate
  assert.match(byId(b, 'ahx-run').note, /estimate/)
  assert.deepEqual(b.customEx.map(c => c.id).sort(), ['ahx-run', 'ahx-sled-pull', 'ahx-sled-push', 'ahx-wall-ball'])
})

test('CrossFit Wednesday: 5x5 squat uses the library, the ladder becomes 3 sets, the prescribed load stays a note', () => {
  const b = build(crossfitWed, 'crossfit')
  const squat = byId(b, '0043')
  assert.deepEqual([squat.sets, squat.reps], [5, 5])
  const thruster = b.routine.ex.find(e => (e.note || '').includes('43/30'))
  assert.ok(thruster)
  assert.equal(thruster.weight, 0)                  // never a made-up number in your history
  assert.equal(thruster.sets, 3)
  assert.equal(b.effort.strengthSets, 5)
  assert.equal(b.effort.condMinutes, 12)            // the stated time cap
})

test('EMOM spreads the minutes over the movements', () => {
  const b = build(crossfitTue, 'crossfit')
  assert.deepEqual(b.routine.ex.map(e => e.sets), [4, 4, 4])
  assert.equal(b.effort.condMinutes, 12)
})

test('AMRAP set counts are estimates and say so', () => {
  const b = build(hyroxThu, 'hyrox')
  assert.ok(b.movements.every(m => m.setsSource === 'amrap-estimate'))
  assert.ok(b.routine.ex.every(e => e.sets === 4))
})

test('structured values: load unit is trusted, per-round values give the set count', () => {
  const b = build(structured, 'crossfit')
  const t = b.routine.ex.find(e => e.weight === 43)
  assert.ok(t)
  assert.equal(t.sets, 3)
})

test('a movement that is not in the dictionary is reported, not invented', () => {
  const p = pub({ id: 1, date: '2026-10-07', blocks: [{ notes: '3 rondas\n10 Zercher Marmotas\n10 Push-up' }] })
  const b = build(p, 'crossfit')
  assert.deepEqual(b.unresolved, ['10 Zercher Marmotas'])
  assert.equal(b.routine.ex.length, 1)
})

test('library exercises resolve to real ids; unknown ones become custom exercises with muscles', () => {
  const b = build(crossfitThu, 'crossfit')
  assert.ok(catalogue.get(byId(b, '0032').id))      // deadlift is in the library
  const box = b.customEx.find(c => c.id === 'ahx-box-jump')
  assert.equal(box.custom, true)
  assert.ok(box.primaries.length > 0)
})

test('the app\'s own muscle maths sees the built routine', () => {
  const b = build(crossfitWed, 'crossfit')
  const load = loadOf(b.routine, b.customEx)
  assert.ok(load.quadriceps > 5, 'five squat sets must register on quads')
  assert.ok(load.gluteal > 0)
  const h = build(hyroxTue, 'hyrox')
  assert.ok(loadOf(h.routine, h.customEx).quadriceps > 0)
})

test('building the same workout twice gives the same routine (stable ids, safe to re-apply)', () => {
  assert.deepEqual(build(hyroxTue, 'hyrox').routine, build(hyroxTue, 'hyrox').routine)
})
