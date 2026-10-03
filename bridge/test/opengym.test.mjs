import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyChanges, syncToOpenGym, OpenGymClient, OpenGymError, checkBaseUrl, redeemPairingCode, verifyApplied, saveToken, loadToken } from '../src/opengym.mjs'
import { jsonRes } from './helpers.mjs'

const mine = { id: 'r-mine', name: 'My own routine', ex: [{ id: '0025', sets: 3, reps: 8, weight: 30 }] }
const cls = (date, name = 'Hyrox') => ({ id: `ahw-${date}-hyrox`, name: `${name} · ${date}`, ex: [{ id: 'ahx-run', sets: 5 }], excludeFromProgression: true })
const free = { id: 'ahf-upper', name: 'Upper body (free)', ex: [{ id: '0673', sets: 4, reps: 10, weight: 60 }] }
const customRun = { id: 'ahx-run', n: 'Run', custom: true, primaries: ['quadriceps'], secondaries: [] }
const baseState = () => ({ routines: [mine], workouts: [{ id: 'w1', d: '2026-09-28' }], customEx: [], week: { mon: ['r-mine'] }, dayPlan: {}, exWeights: { '0025': 30 }, _rev: 4, _ts: 1000 })
const plan = () => ({ routines: [cls('2026-10-06')], free: [free], customEx: [customRun], schedule: { '2026-10-06': 'ahw-2026-10-06-hyrox', '2026-10-05': 'ahf-upper' } })

test('applying adds the routines, the custom exercise and the schedule, and touches nothing else', () => {
  const before = baseState()
  const { next, report } = applyChanges(before, plan())
  assert.deepEqual(before, baseState(), 'input must not be mutated')
  assert.deepEqual(next.routines.map(r => r.id), ['r-mine', 'ahw-2026-10-06-hyrox', 'ahf-upper'])
  assert.deepEqual(next.workouts, before.workouts)
  assert.deepEqual(next.exWeights, before.exWeights)
  assert.deepEqual(next.week, before.week)
  assert.deepEqual(next.dayPlan, { '2026-10-06': 'ahw-2026-10-06-hyrox', '2026-10-05': 'ahf-upper' })
  assert.deepEqual(next.customEx.map(c => c.id), ['ahx-run'])
  assert.equal(report.added.length, 2)
})

test('applying twice gives exactly the same state (idempotent)', () => {
  const once = applyChanges(baseState(), plan()).next
  const twice = applyChanges(once, plan())
  assert.deepEqual(twice.next, once)
  assert.deepEqual(twice.report.added, [])
  assert.equal(twice.report.refreshed.length, 1)
})

test('a class routine is refreshed from the newest workout text; your free routine is never overwritten', () => {
  const once = applyChanges(baseState(), plan()).next
  once.routines.find(r => r.id === 'ahf-upper').ex[0].weight = 65     // progression you made in the app
  const p = plan(); p.routines[0].ex[0].sets = 6
  const { next, report } = applyChanges(once, p)
  assert.equal(next.routines.find(r => r.id === 'ahf-upper').ex[0].weight, 65)
  assert.equal(next.routines.find(r => r.id === 'ahw-2026-10-06-hyrox').ex[0].sets, 6)
  assert.ok(report.kept.some(k => k.includes('Upper body')))
})

test('a free routine you already have under that name is reused, not duplicated', () => {
  const s = baseState(); s.routines.push({ id: 'abc', name: 'upper body (FREE)', ex: [] })
  const { next } = applyChanges(s, plan())
  assert.equal(next.routines.filter(r => /upper body/i.test(r.name)).length, 1)
  assert.equal(next.dayPlan['2026-10-05'], 'abc')
})

test('a day that already has your own plan, or "rest", is left alone and reported', () => {
  const s = baseState(); s.dayPlan = { '2026-10-06': 'r-mine', '2026-10-05': 'rest' }
  const { next, report } = applyChanges(s, plan())
  assert.deepEqual(next.dayPlan, { '2026-10-06': 'r-mine', '2026-10-05': 'rest' })
  assert.deepEqual(report.skippedDays.map(d => d.iso).sort(), ['2026-10-05', '2026-10-06'])
})

test('a day that holds one of its own earlier routines is replaced (re-planning a week)', () => {
  const s = baseState(); s.dayPlan = { '2026-10-06': 'ahw-2026-10-06-crossfit' }
  assert.equal(applyChanges(s, plan()).next.dayPlan['2026-10-06'], 'ahw-2026-10-06-hyrox')
})

// ---- the network side, against a pretend server

function server(initial, { conflicts = 0, drop = false } = {}) {
  const s = { state: structuredClone(initial), rev: initial._rev, puts: [], gets: 0, conflictsLeft: conflicts }
  s.fetch = async (url, init = {}) => {
    const u = new URL(url)
    assert.match(init.headers.authorization || '', /^Bearer TOKEN/, 'every data call carries the bearer token')
    if (u.pathname === '/api/data' && (init.method || 'GET') === 'GET') { s.gets++; return jsonRes({ state: s.state, rev: s.rev }) }
    if (u.pathname === '/api/data' && init.method === 'PUT') {
      const body = JSON.parse(init.body)
      s.puts.push(body)
      if (s.conflictsLeft > 0) {
        s.conflictsLeft--
        s.state = { ...s.state, workouts: [...s.state.workouts, { id: `late${s.rev}` }] }   // someone saved in between
        s.rev++
        return jsonRes({ error: 'conflict', rev: s.rev, state: s.state }, { status: 409 })
      }
      if (body.baseRev !== s.rev) return jsonRes({ error: 'conflict', rev: s.rev, state: s.state }, { status: 409 })
      if (!drop) { s.state = { ...body.state, _rev: s.rev + 1 }; s.rev++ }
      return jsonRes({ ok: true, rev: s.rev })
    }
    return jsonRes({}, { status: 404 })
  }
  return s
}
const mk = srv => new OpenGymClient({ baseUrl: 'https://gym.example.netlify.app', token: 'TOKEN-123', fetchImpl: srv.fetch })
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'))
const OLD = () => ({ ...baseState(), _ts: 1 })

test('a dry run reads but never writes', async () => {
  const srv = server(OLD())
  const r = await syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: true })
  assert.equal(r.dryRun, true)
  assert.equal(srv.puts.length, 0)
  assert.equal(r.report.added.length, 2)
})

test('a real write makes a backup first, sends the revision it read, and reads the result back', async () => {
  const srv = server(OLD()), dir = tmp()
  const r = await syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: dir, dryRun: false, now: () => 5_000_000 })
  assert.equal(srv.puts.length, 1)
  assert.equal(srv.puts[0].baseRev, 4)
  assert.equal(r.verified, true)
  const saved = JSON.parse(fs.readFileSync(r.backup, 'utf8'))
  assert.equal(saved.routines.length, 1, 'the backup is the state from before')
  assert.equal(srv.state.workouts.length, 1, 'your workouts are untouched')
  assert.ok(srv.state.routines.some(x => x.id === 'ahf-upper'))
})

test('it refuses to write while the app looks to be in use, unless forced', async () => {
  const srv = server({ ...baseState(), _ts: 4_990_000 })
  await assert.rejects(() => syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: false, now: () => 5_000_000 }), e => e.code === 'BUSY')
  assert.equal(srv.puts.length, 0)
  const r = await syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: false, force: true, now: () => 5_000_000 })
  assert.equal(r.verified, true)
})

test('one conflict is merged on top of what is there now; nothing the other device saved is lost', async () => {
  const srv = server(OLD(), { conflicts: 1 })
  const r = await syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: false, now: () => 5_000_000 })
  assert.equal(srv.puts.length, 2)
  assert.ok(srv.state.workouts.some(w => w.id === 'late4'), 'the workout saved in between is still there')
  assert.equal(r.verified, true)
})

test('two conflicts in a row stop with a clear message and a backup', async () => {
  const srv = server(OLD(), { conflicts: 5 })
  await assert.rejects(() => syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: false, now: () => 5_000_000 }), e => e.code === 'CONFLICT' && Boolean(e.backup))
})

test('read-back catches a save that did not stick', async () => {
  const srv = server(OLD(), { drop: true })
  const r = await syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: false, now: () => 5_000_000 })
  assert.equal(r.verified, false)
  assert.ok(r.problems.length > 0)
})

test('an account with no data yet is not initialised by the bridge', async () => {
  const srv = server(OLD()); srv.state = null
  await assert.rejects(() => syncToOpenGym({ client: mk(srv), plan: plan(), backupDir: tmp(), dryRun: true }), e => e.code === 'NO_STATE')
})

test('the token is only ever sent to an https address (or localhost)', () => {
  assert.throws(() => checkBaseUrl('http://gym.example.com'), OpenGymError)
  assert.throws(() => checkBaseUrl('not a url'), OpenGymError)
  assert.equal(checkBaseUrl('https://gym.example.com/some/path'), 'https://gym.example.com')
  assert.equal(checkBaseUrl('http://localhost:3000'), 'http://localhost:3000')
})

test('pairing: a good code returns a token, a bad one a clear error; the token file is private', async () => {
  const ok = async () => jsonRes({ token: 'TOKEN-XYZ', user: { name: 'Sara' } })
  const info = await redeemPairingCode('https://gym.example.com', ' abc123 ', ok)
  assert.equal(info.token, 'TOKEN-XYZ')
  await assert.rejects(() => redeemPairingCode('https://gym.example.com', 'bad', async () => jsonRes({ error: 'invalid or expired code' }, { status: 400 })), e => e.code === 'PAIR' && !e.message.includes('bad'))
  const file = path.join(tmp(), 't.json')
  saveToken(file, info)
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0)
  assert.equal(loadToken(file).token, 'TOKEN-XYZ')
  assert.equal(loadToken(path.join(tmp(), 'missing.json')), null)
})

test('verifyApplied reports what is missing', () => {
  const p = verifyApplied({ routines: [], dayPlan: {} }, {}, { added: ['a'], refreshed: [], scheduled: [{ iso: '2026-10-06', id: 'a' }] })
  assert.equal(p.ok, false)
  assert.equal(p.problems.length, 2)
})
