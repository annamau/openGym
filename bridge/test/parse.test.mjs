import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecordDate, normalizeWorkout, classify, plain, DEFAULT_RULES } from '../src/parse.mjs'
import { hyroxTue, crossfitTue, structured, realShape, pub } from './fixtures/week.mjs'

test('Spanish record dates become ISO dates', () => {
  assert.equal(parseRecordDate('6 de Octubre de 2026'), '2026-10-06')
  assert.equal(parseRecordDate('14 de octubre de 2026'), '2026-10-14')
  assert.equal(parseRecordDate('1 de Setiembre de 2026'), '2026-09-01')
  assert.equal(parseRecordDate('Martes 6 de Octubre'), null)
  assert.equal(parseRecordDate('32 de Octubre de 2026'), null)
  assert.equal(parseRecordDate(undefined), null)
})

test('a publication is read into a small stable shape, using the recordDate not the post time', () => {
  const n = normalizeWorkout({ ...hyroxTue.post, creationDate: '2026-10-04 20:01' }, hyroxTue.detail)
  assert.equal(n.ok, true)
  assert.equal(n.workout.date, '2026-10-06')
  assert.equal(n.workout.sourceId, 9101)
  assert.deepEqual(n.workout.titles, ['Hyrox Calentamiento', 'Hyrox Engine'])
  assert.equal(n.workout.blocks.length, 3)       // the HYROX marker block, the warm-up and the main block
})

test('structured exercises keep their units and loads', () => {
  const n = normalizeWorkout(structured.post, structured.detail)
  const [thruster, pullup] = n.workout.exercises
  assert.deepEqual(thruster.values, [21, 15, 9])
  assert.equal(thruster.valueUnit, 'reps')
  assert.equal(thruster.load, 43)
  assert.equal(thruster.loadUnit, 'kg')
  assert.equal(pullup.load, null)
})

test('deleted blocks and their exercises are ignored', () => {
  const p = pub({ id: 1, date: '2026-10-06', blocks: [{ notes: 'a' }, { notes: 'b' }], ejer: [{ ejerName: 'Row', tipoWOD: 1, formaReg: 3, valor1: [10] }] })
  p.detail.TIPOWODs[1].deleted = '1'
  const n = normalizeWorkout(p.post, p.detail)
  assert.equal(n.workout.blocks.length, 1)
  assert.equal(n.workout.exercises.length, 0)
})

test('unreadable publications are reported, never thrown', () => {
  assert.deepEqual(normalizeWorkout(null, {}), { ok: false, reason: 'not-an-object' })
  assert.equal(normalizeWorkout({ id: 1 }, { TIPOWODs: [] }).reason, 'missing-blocks')
  const p = pub({ id: 1, date: '2026-10-06', blocks: [{ notes: 'x' }] })
  p.detail.recordDate = 'sometime'
  assert.equal(normalizeWorkout(p.post, p.detail).reason, 'unrecognised-date')
})

test('classification: a "HYROX" block marks the Hyrox class, every other publication is CrossFit', () => {
  const w = x => normalizeWorkout(x.post, x.detail).workout
  assert.equal(classify(w(hyroxTue)), 'hyrox')
  assert.equal(classify(w(crossfitTue)), 'crossfit')
  assert.equal(classify(w(realShape())), 'hyrox')
  const lowerMarker = pub({ id: 5, date: '2026-10-06', blocks: [{ notes: ' hyrox ' }, { title: '3 RFT', notes: '' }] })
  assert.equal(classify(w(lowerMarker)), 'hyrox')
  const plainClass = pub({ id: 6, date: '2026-10-06', blocks: [{ title: 'EMOM', notes: 'x' }] })
  assert.equal(classify(w(plainClass)), 'crossfit')
})

test('a title that starts with Hyrox still counts; one that only mentions it later does not', () => {
  const w = x => normalizeWorkout(x.post, x.detail).workout
  assert.equal(classify(w(pub({ id: 6, date: '2026-10-06', blocks: [{ title: '  HYROX sim', notes: 'x' }] }))), 'hyrox')
  assert.equal(classify(w(pub({ id: 7, date: '2026-10-06', blocks: [{ title: 'Friday: Hyrox', notes: 'x' }] }))), 'crossfit')
})

test('with crossfitIfNoMarker off, a publication without the marker is "unclear"', () => {
  const w = x => normalizeWorkout(x.post, x.detail).workout
  const rules = { ...DEFAULT_RULES, crossfitIfNoMarker: false }
  assert.equal(classify(w(crossfitTue), rules), 'unclear')
  assert.equal(classify(w(hyroxTue), rules), 'hyrox')
})

test('Aimharder HTML becomes plain text: line breaks, entities, curly quotes', () => {
  assert.equal(plain('EMOM 12\u2019<br />Min 1: 10 Burpee&nbsp;&amp; Row<br/>&#039;fuerte&#039; &#x41;'), "EMOM 12'\nMin 1: 10 Burpee & Row\n'fuerte' A")
  assert.equal(plain('<p>uno</p><p>dos</p>'), 'uno\ndos')
  assert.equal(plain(null), '')
  assert.equal(plain('&#1114112;x'), 'x')       // not a valid code point: dropped
})

test('the real shape keeps format names, repeats, pair loads and the warm-up flag', () => {
  const { workout } = normalizeWorkout(realShape().post, realShape().detail)
  assert.equal(workout.blocks[1].section, 2)
  assert.equal(workout.blocks[3].notes, "Cada minuto 'ritmo fuerte'\nsin parar")
  const by = n => workout.exercises.find(e => e.name === n)
  assert.equal(by('Double DB Thruster').loadText, '20/15')
  assert.equal(by('Double DB Thruster').load, null)
  assert.equal(by('Back Squat').loadUnit, '%RM')
  assert.equal(by('Back Squat').repeat, 5)
  assert.equal(by("Farmer's Carry").valueUnit, 'm')
  assert.equal(by('Push Press').values.length, 5)
})
