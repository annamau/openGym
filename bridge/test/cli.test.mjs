import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { scrub, defaultMonday } from '../src/cli.mjs'
import { ROOT } from './helpers.mjs'

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
