import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecordDate, normalizeWorkout, classify, DEFAULT_RULES } from '../src/parse.mjs'
import { hyroxTue, crossfitTue, structured, pub } from './fixtures/week.mjs'

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
  assert.equal(n.workout.blocks.length, 2)
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

test('classification: title starting with Hyrox, untitled CrossFit, anything else is unclear', () => {
  const w = x => normalizeWorkout(x.post, x.detail).workout
  assert.equal(classify(w(hyroxTue)), 'hyrox')
  assert.equal(classify(w(crossfitTue)), 'crossfit')
  const odd = pub({ id: 5, date: '2026-10-06', blocks: [{ title: 'Open Gym', notes: 'x' }] })
  assert.equal(classify(w(odd)), 'unclear')
  const lower = pub({ id: 6, date: '2026-10-06', blocks: [{ title: '  HYROX sim', notes: 'x' }] })
  assert.equal(classify(w(lower)), 'hyrox')
  const notAtStart = pub({ id: 7, date: '2026-10-06', blocks: [{ title: 'Friday: Hyrox', notes: 'x' }] })
  assert.equal(classify(w(notAtStart), DEFAULT_RULES), 'unclear')
})
