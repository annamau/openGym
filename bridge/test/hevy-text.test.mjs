import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseHevyText, workingSet } from '../src/hevy-text.mjs'
import { ROOT } from './helpers.mjs'

const read = f => fs.readFileSync(`${ROOT}/config/free/${f.replace('.txt', '.example.txt')}`, 'utf8')   // the generic examples, not your own files

test('a Hevy share text is read completely', () => {
  const p = parseHevyText(read('legs.txt'))
  assert.equal(p.name, 'Example legs routine')
  assert.match(p.date, /Jan 12, 2026/)
  assert.deepEqual(p.exercises.map(e => e.title), ['Lunge (Barbell)', 'Lying Leg Curl (Machine)', 'Hip Thrust (Machine)', 'Hip Abduction (Machine)', 'Standing Calf Raise (Machine)'])
  assert.deepEqual(p.exercises.map(e => e.sets.length), [3, 3, 3, 3, 3])
  assert.deepEqual(p.warnings, [])
})

test('collapsed "3 sets 40 kg x 10" lines expand to three sets', () => {
  const abd = parseHevyText(read('legs.txt')).exercises[3]
  assert.deepEqual(abd.sets, Array(3).fill({ weight: 40, unit: 'kg', reps: 10, rpe: null }))
})

test('RPE, decimals, the emoji in the title and the footer link are handled', () => {
  const p = parseHevyText(read('upper.txt'))
  assert.equal(p.name, 'Example upper routine')
  assert.equal(p.exercises.length, 9)
  assert.deepEqual(p.exercises[3].sets[3], { weight: 27.5, unit: 'kg', reps: 8, rpe: 10 })
  assert.equal(p.exercises.some(e => /hevy/i.test(e.title)), false)
})

test('the working set is the last set that carries weight', () => {
  const calf = parseHevyText(read('legs.txt')).exercises[4].sets          // 20, 30, then 0 kg
  assert.equal(calf.at(-1).weight, 0)
  assert.equal(workingSet(calf).weight, 30)
  assert.equal(workingSet([{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }]).reps, 10)
})

test('lines it cannot read are reported', () => {
  const p = parseHevyText('Name\nMonday, Jul 27, 2026 at 7:02am\n\nSquat\nSet 1: banana\n')
  assert.equal(p.exercises.length, 0)
  assert.ok(p.warnings.some(w => w.includes('banana')))
})
