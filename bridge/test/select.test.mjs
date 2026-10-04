import test from 'node:test'
import assert from 'node:assert/strict'
import { isSelected, pruneItems, weekDates, parseSelect, applySelection, resolveWeek } from '../src/select.mjs'
import { normalizeWorkout, DEFAULT_RULES } from '../src/parse.mjs'
import { week, pub } from './fixtures/week.mjs'

const workouts = week.map(x => normalizeWorkout(x.post, x.detail).workout)
const dates = weekDates('2026-10-05')
const defaults = { tue: 'hyrox', wed: 'crossfit', thu: 'hyrox' }

test('week dates start on the Monday given', () => {
  assert.equal(dates.mon, '2026-10-05')
  assert.equal(dates.sun, '2026-10-11')
})

test('parseSelect reads day=class lists and refuses anything unclear', () => {
  assert.deepEqual(parseSelect('tue=hyrox, wed=CrossFit'), { tue: 'hyrox', wed: 'crossfit' })
  assert.throws(() => parseSelect('tue=yoga'), /cannot read/)
  assert.throws(() => parseSelect('funday=hyrox'), /cannot read/)
})

test('selection precedence: --select replaces; otherwise defaults minus skip plus add', () => {
  assert.deepEqual(applySelection(defaults, {}), defaults)
  assert.deepEqual(applySelection(defaults, { skip: ['thu'] }), { tue: 'hyrox', wed: 'crossfit' })
  assert.deepEqual(applySelection(defaults, { add: { fri: 'crossfit' } }), { ...defaults, fri: 'crossfit' })
  assert.deepEqual(applySelection(defaults, { select: { mon: 'hyrox' }, skip: ['tue'] }), { mon: 'hyrox' })
  assert.deepEqual(applySelection(defaults, { add: { wed: 'hyrox' } }).wed, 'hyrox')
})

test('two publications per day resolve to the one for the selected class', () => {
  const r = resolveWeek(workouts, defaults, dates, DEFAULT_RULES)
  assert.deepEqual(r.map(x => [x.day, x.status]), [['tue', 'ok'], ['wed', 'ok'], ['thu', 'ok']])
  assert.equal(r[0].workout.sourceId, 9101)  // Tue Hyrox, not the untitled CrossFit
  assert.equal(r[1].workout.sourceId, 9201)  // Wed CrossFit, not the Hyrox
  assert.equal(r[2].workout.sourceId, 9301)
})

test('nothing published for a date is "missing", never an empty success', () => {
  const r = resolveWeek(workouts, { ...defaults, fri: 'crossfit' }, dates, DEFAULT_RULES)
  assert.equal(r.find(x => x.day === 'fri').status, 'missing')
})

test('several matching publications are ambiguous and none is picked', () => {
  const extra = normalizeWorkout(...Object.values(pub({ id: 9999, date: '2026-10-06', blocks: [{ notes: 'EMOM 10' }] }))).workout
  const r = resolveWeek([...workouts, extra], { tue: 'crossfit' }, dates, DEFAULT_RULES)
  assert.equal(r[0].status, 'ambiguous')
  assert.deepEqual(r[0].candidates.map(c => c.sourceId).sort(), [9102, 9999])
  assert.equal(r[0].workout, undefined)
})

test('a publication without the HYROX marker is the CrossFit one', () => {
  const odd = normalizeWorkout(...Object.values(pub({ id: 7777, date: '2026-10-09', blocks: [{ title: 'Open Gym', notes: 'x' }] }))).workout
  const r = resolveWeek([odd], { fri: 'crossfit' }, dates, DEFAULT_RULES)
  assert.equal(r[0].status, 'ok')
  assert.equal(r[0].workout.sourceId, 7777)
})

test('with crossfitIfNoMarker off, such a publication is surfaced as unclear, not guessed', () => {
  const odd = normalizeWorkout(...Object.values(pub({ id: 7777, date: '2026-10-09', blocks: [{ title: 'Open Gym', notes: 'x' }] }))).workout
  const r = resolveWeek([odd], { fri: 'crossfit' }, dates, { ...DEFAULT_RULES, crossfitIfNoMarker: false })
  assert.equal(r[0].status, 'missing')
  assert.equal(r[0].unclear.length, 1)
})

test('only the classes you attend are selected: by weekday and class, whatever the week', () => {
  const ids = workouts.filter(w => isSelected(w, defaults, DEFAULT_RULES)).map(w => w.sourceId).sort()
  assert.deepEqual(ids, [9101, 9201, 9301])                      // Tue Hyrox, Wed CrossFit, Thu Hyrox
  const nextWeek = normalizeWorkout(...Object.values(pub({ id: 1, date: '2026-10-13', blocks: [{ notes: 'HYROX' }] }))).workout   // a Tuesday
  assert.equal(isSelected(nextWeek, defaults, DEFAULT_RULES), true)
  const saturday = normalizeWorkout(...Object.values(pub({ id: 2, date: '2026-10-10', blocks: [{ notes: 'x' }] }))).workout
  assert.equal(isSelected(saturday, defaults, DEFAULT_RULES), false)
})

test('pruneItems drops everything else, including what cannot be read', () => {
  const items = [...week, { post: null, detail: null }]
  const { kept, dropped } = pruneItems(items, defaults, DEFAULT_RULES)
  assert.deepEqual(kept.map(i => i.post.id).sort(), [9101, 9201, 9301])
  assert.equal(dropped, 4)
})
