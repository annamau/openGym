import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { scrub, defaultMonday } from '../src/cli.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'
import { week } from './fixtures/week.mjs'

test('files sent back for diagnosis lose anything that looks personal', () => {
  const clean = scrub({ id: 1, title: 'WOD', email: 'a@b.c', user: { phone: '1', telefono: '2', name: 'x', token: 't' }, list: [{ cookie: 'c', ok: 1 }] })
  assert.deepEqual(clean, { id: 1, title: 'WOD', user: { name: 'x' }, list: [{ ok: 1 }] })
})

test('on a weekend the week that matters is the one starting next Monday', () => {
  assert.equal(defaultMonday('2026-10-03'), '2026-10-05')   // Saturday
  assert.equal(defaultMonday('2026-10-04'), '2026-10-05')   // Sunday
  assert.equal(defaultMonday('2026-10-07'), '2026-10-05')   // Wednesday: this week
  assert.equal(defaultMonday('2026-10-05'), '2026-10-05')
})

const run = (...args) => execFileSync(process.execPath, ['src/cli.mjs', ...args], { cwd: ROOT, encoding: 'utf8' })

test('plan --demo shows the days, overlaps, objectives and a free-workout pick', () => {
  const out = run('plan', '--demo')
  for (const needle of ['TUE 6 Oct — Hyrox', 'WED 7 Oct — CrossFit', 'THU 8 Oct — Hyrox', 'OVERLAPS', 'OBJECTIVES', 'FREE WORKOUT', 'Recommended:', 'nothing saved']) assert.ok(out.includes(needle), needle)
})

test('times of day are real clock times, also for last Sunday\'s run and the 18:30 runs', () => {
  const out = run('plan', '--demo')
  assert.ok(!/ -\d+:\d\d/.test(out), 'no negative hours')
  assert.match(out, /Sun 09:00 long run/)
  assert.match(out, /Mon 18:30 easy run|Fri 18:30 easy run/)
})

test('plan --demo --skip thu / --select / --free / --no-free change what is analysed', () => {
  assert.ok(!run('plan', '--demo', '--skip', 'thu').includes('THU 8 Oct'))
  assert.ok(run('plan', '--demo', '--select', 'tue=hyrox').includes('from --select'))
  assert.ok(run('plan', '--demo', '--free', 'legs').includes('You asked for Legs quick (free)'))
  assert.ok(run('plan', '--demo', '--no-free').includes('no free workout chosen'))
})

test('a day with nothing published is reported, not silently dropped', () => {
  assert.match(run('plan', '--demo', '--add', 'fri=crossfit'), /FRI 9 Oct — CrossFit: NOT FOUND/)
})

test('a bad option is a clear error and exit code, not a stack trace', () => {
  assert.throws(() => execFileSync(process.execPath, ['src/cli.mjs', 'plan', '--demo', '--select', 'tue=yoga'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }), e => /cannot read/.test(e.stderr) && !/at .*\.mjs/.test(e.stderr))
})

test('clean deletes every publication that is not a selected class, and says how many', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-clean-'))
  const file = path.join(dir, 'week-raw.json')
  fs.writeFileSync(file, JSON.stringify({ gym: { name: 'x' }, items: week }))
  const out = run('clean', '--out', file)
  assert.match(out, /Kept 3 .*deleted 3 that were not selected/)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(saved.items.map(i => i.post.id).sort(), [9101, 9201, 9301])
  assert.deepEqual(saved.selection, { tue: 'hyrox', wed: 'crossfit', thu: 'hyrox' })
  // a different selection keeps a different set, and clean never brings anything back
  run('clean', '--out', file, '--select', 'tue=hyrox')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items.map(i => i.post.id), [9101])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('plan lists the exercises of each class routine, as apply would create them', () => {
  const out = run('plan', '--demo')
  assert.match(out, /Routine "Hyrox · Tue 6 Oct" \(what apply would create in openGym\):/)
  assert.match(out, /\n {6}\S.* \d+×\d+/)
})
