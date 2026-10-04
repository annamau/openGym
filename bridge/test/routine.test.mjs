import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkout } from '../src/parse.mjs'
import { buildRoutine, parseFormat, isFormatLine, loadHint, textSections, emomShape } from '../src/routine.mjs'
import { matchMovement, readSegment, segmentsOf, isSkippable } from '../src/movements.mjs'
import { catalogue, loadOf } from '../src/appbridge.mjs'
import { hyroxTue, crossfitTue, crossfitWed, hyroxThu, crossfitThu, structured, realShape, pub } from './fixtures/week.mjs'

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

// ---- the real shape: structured exercises, format names, warm-up section, pair loads ----

test('real shape: warm-up section, the HYROX marker and free-text rest rows are not counted', () => {
  const b = build(realShape(), 'hyrox')
  assert.deepEqual(b.skippedBlocks, ['3 RFT'])                    // the sstipo-2 block
  assert.ok(!b.movements.some(m => /air squat|descanso/i.test(m.text)))
  assert.deepEqual(b.unresolved, [])
})

test('real shape: the numeric timecap field is ignored (its meaning is a code, not minutes)', () => {
  const a = build(realShape(3), 'hyrox'), c = build(realShape(60), 'hyrox')
  assert.deepEqual(a.routine, c.routine)
  assert.deepEqual(a.effort, c.effort)
})

test('real shape: "3 RFT" gives the rounds, and pair loads / %RM stay in the note, never in the weight', () => {
  const b = build(realShape(), 'hyrox')
  const thruster = b.routine.ex.find(e => e.sets === 3 && /20\/15/.test(e.note))
  assert.ok(thruster, 'double DB thruster: 3 rounds, "20/15" kept as text')
  assert.equal(thruster.weight, 0)
  const squat = byId(b, '0043')
  assert.equal(squat.sets, 5)                                      // EMOM roundrepeat
  assert.equal(squat.reps, 12)
  assert.equal(squat.weight, 0)
  assert.match(squat.note, /60 %RM/)
})

test('real shape: a unit in the name ("Row (m)") makes it a distance, so a cardio entry', () => {
  const b = build(realShape(), 'hyrox')
  const row = b.routine.ex.find(e => e.mode === 'cardio' && /rower|row/i.test(e.id))
  assert.ok(row, 'row is cardio')
  assert.ok(row.min > 0 && row.min < 3, `250 m of rowing is about a minute, got ${row.min}`)
})

test('real shape: EMOM minutes are rounds × movements and are counted once for the block', () => {
  const b = build(realShape(), 'hyrox')
  const emom = build(pub({ id: 1, date: '2026-10-07', blocks: [{ title: 'EMOM', notes: '' }], ejer: [
    { ejerName: 'Back Squat', tipoWOD: 0, tWODnom: 'EMOM', formaReg: '3', valor1: ['10'], roundrepeat: '6' },
    { ejerName: 'Burpee', tipoWOD: 0, tWODnom: 'EMOM', formaReg: '3', valor1: ['10'], roundrepeat: '6' },
  ] }), 'crossfit')
  assert.equal(emom.effort.condMinutes, 12)
  assert.deepEqual(emom.routine.ex.map(e => e.sets), [6, 6])
  assert.ok(b.effort.condMinutes > 0)
})

test('real shape: time stations are timed rows (seconds per station), rounds from "round"', () => {
  const b = build(realShape(), 'hyrox')
  const ski = b.routine.ex.find(e => /skierg|ski/i.test(e.id))
  assert.equal(ski.mode, 'cardio')
  assert.equal(ski.sets, 2)
  assert.ok(Math.abs(ski.min - 0.75) < 0.1)
})

test('real shape: a value list is the set list (OPEN 3,3,3,3,3 → 5×3); ladders keep the sum of reps', () => {
  const b = build(realShape(), 'hyrox')
  const press = b.routine.ex.find(e => /push-press/.test(e.id))
  assert.equal(press.sets, 5)
  assert.equal(press.reps, 3)
  assert.match(press.note, /EMPEZAMOS EN 50%/)
  const sdhp = b.routine.ex.find(e => /sdhp/.test(e.id))
  assert.equal(sdhp.sets, 3)
  assert.equal(sdhp.reps, 15)                                       // 21+15+9 = 45 = 3 × 15
  assert.match(sdhp.note, /reps 21-15-9/)
})

test('real shape: the same movement in two blocks becomes one row whose sets × reps is the total', () => {
  const b = build(realShape(), 'hyrox')
  const burpee = b.routine.ex.find(e => /burpee/.test(e.id))
  assert.equal(burpee.sets, 8)                                      // 5 EMOM + 3 ladder
  assert.equal(burpee.reps, 12)                                     // (5×10 + 3×15) / 8 ≈ 11.9
  assert.equal(b.routine.ex.filter(e => /burpee/.test(e.id)).length, 1)
})

test('real shape: names are decoded before matching, and a scapular pull-up is not a pull-up', () => {
  const b = build(realShape(), 'hyrox')
  assert.ok(b.movements.some(m => m.movement === 'Farmers carry'), "Farmer&#039;s Carry decodes to Farmer's Carry")
  assert.ok(b.movements.some(m => m.movement === 'Scapular pull-up'))
  assert.ok(!b.movements.some(m => m.movement === 'Pull-up'))
})

test('real shape: block notes the coach wrote travel into the routine once per block', () => {
  const b = build(realShape(), 'hyrox')
  const notes = b.routine.ex.map(e => e.note || '').join(' ')
  assert.equal((notes.match(/ritmo fuerte/g) || []).length, 1)      // on the first movement of the EMOM block only
  assert.match(byId(b, '0043').note, /Cada minuto 'ritmo fuerte' \/ sin parar/)
})

// ---- free text with several formats in one block (Saturday partner workouts are published like this) ----

test('free text: each header (rounds, ladder, EMOM) applies to the movements under it, not to the whole block', () => {
  const sec = textSections('Partners fts\n10 Rounds For Time\n10 Hang Power Clean (40/30)\n10 Pull Ups\n5 Rounds For Time\n5 Bar Muscle Up/5 Burpee\n*tras cada serie subir carga')
  assert.deepEqual(sec.map(x => [x.fmt.kind, x.fmt.rounds, x.segs.length]), [['rounds', 10, 2], ['rounds', 5, 2]])
  const b = build(pub({ id: 1, date: '2026-10-07', blocks: [{ notes: '10 Rounds For Time\n10 Hang Power Clean (40/30)\n10 Pull Ups\n5 Rounds For Time\n5 Bar Muscle Up/5 Burpee' }] }), 'crossfit')
  const sets = Object.fromEntries(b.movements.map(m => [m.movement, m.sets]))
  assert.deepEqual(sets, { Clean: 10, 'Pull-up': 10, 'Muscle-up': 5, Burpee: 5 })
})

test('free text: a strength line keeps its own NxM; coach remarks are not movements', () => {
  const sec = textSections('5x5 Back Squat\n3 rondas\n10 Push-up\n(escalar si hace falta)')
  assert.deepEqual(sec.map(x => [x.fmt.kind, x.segs.length]), [['strength', 1], ['rounds', 1]])
})

test('segments: commas inside parentheses and decimals stay together; "5 X/5 Y" splits', () => {
  assert.deepEqual(segmentsOf('Db snatch (22,5/15)'), ['Db snatch (22,5/15)'])
  assert.deepEqual(segmentsOf('5 Bar Muscle Up/5 Burpee Chest To Bar'), ['5 Bar Muscle Up', '5 Burpee Chest To Bar'])
  assert.deepEqual(segmentsOf('200m Run, 10 Air Squat\n12 Cal Row'), ['200m Run', '10 Air Squat', '12 Cal Row'])
  assert.deepEqual(segmentsOf('Thruster (43/30 kg)'), ['Thruster (43/30 kg)'])
})

test('EMOM repeat: rounds normally; read as total minutes when that would be an impossible block', () => {
  assert.deepEqual(emomShape(5, 3), { rounds: 5, minutes: 15, asMinutes: false })
  assert.deepEqual(emomShape(40, 4), { rounds: 10, minutes: 40, asMinutes: true })
  assert.deepEqual(emomShape(25, 5), { rounds: 5, minutes: 25, asMinutes: true })
  assert.deepEqual(emomShape(20, 1), { rounds: 20, minutes: 20, asMinutes: false })
})

test('dictionary: movements seen in the gym\'s real programming resolve (and drills do not count)', () => {
  for (const [text, key] of [
    ['KB SINGLE LEG DEADLIFT', 'single-leg-rdl'], ['Scapular Pull up', 'scap-pullup'], ['active bar hang', 'active-hang'],
    ['DOUBLE DB DL', 'deadlift'], ['Double DB hang C&J', 'clean'], ['Sit -ups.', 'sit-up'], ['Heel Drops', 'calf-raise'],
    ['FARTLECK', 'run'], ['40 cals a repartir', 'cardio-machine'], ['Echo Bike (Cal)', 'bike'], ['12 Cal Row', 'rower'],
    ['Strict Chin-ups', 'pull-up'], ['SHOULDER TAPS', 'shoulder-taps'], ['Mountain Climbers', 'mountain-climber'],
  ]) assert.equal(matchMovement(text)?.key, key, text)
  for (const drill of ['Rotación torácica', "World's greatest strech", 'Walkout', 'Hip Opener', '20m Talon gluteo']) assert.ok(isSkippable(drill), drill)
})

test('format-looking lines are not reported as unrecognised movements', () => {
  for (const line of ["Del 0' al 10':", 'Evento 2: 21-15-9 (TC 10\')', 'Por Parejas:', '*Cambio cada 2\'30"', '2 min ON/1 min Off x 3', 'METCON']) assert.ok(isFormatLine(line), line)
})

test('a cardio movement inside an EMOM gets its share of the block per set, not the whole block each set', () => {
  const b = build(pub({ id: 1, date: '2026-10-07', blocks: [{ title: 'EMOM', notes: '' }], ejer: [
    { ejerName: 'Echo Bike (Cal)', tipoWOD: 0, tWODnom: 'EMOM', formaReg: '3', valor1: [], roundrepeat: '5' },
    { ejerName: 'Goblet squat', tipoWOD: 0, tWODnom: 'EMOM', formaReg: '3', valor1: ['15'], roundrepeat: '5' },
    { ejerName: 'Burpee', tipoWOD: 0, tWODnom: 'EMOM', formaReg: '3', valor1: ['10'], roundrepeat: '5' },
  ] }), 'crossfit')
  const bike = b.routine.ex.find(e => e.mode === 'cardio')
  assert.equal(bike.sets, 5)
  assert.equal(bike.min, 1)                       // 15 block minutes / 3 movements / 5 sets
  assert.equal(b.effort.condMinutes, 15)
})
