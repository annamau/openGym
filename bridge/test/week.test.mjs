import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cmdWeek } from '../src/cli.mjs'
import { saveToken } from '../src/opengym.mjs'
import { jsonRes } from './helpers.mjs'
import { week } from './fixtures/week.mjs'

const BASE = 'https://gym.example.netlify.app'
const oldState = () => ({ routines: [{ id: 'mine', name: 'My own routine', ex: [] }], workouts: [{ id: 'w1', d: '2026-09-28' }], customEx: [], week: {}, dayPlan: {}, exWeights: {}, _rev: 4, _ts: 1 })

/** A pretend openGym: /api/data plus the pairing endpoint. */
function pretendServer({ rejectToken } = {}) {
  const s = { state: oldState(), rev: 4, puts: [], pairs: 0 }
  s.fetch = async (url, init = {}) => {
    const u = new URL(url)
    if (u.pathname === '/api/pair/redeem') { s.pairs++; return jsonRes({ token: 'TOKEN-NEW', user: { name: 'Sara' } }) }
    if (rejectToken && init.headers?.authorization === `Bearer ${rejectToken}`) return jsonRes({}, { status: 401 })
    assert.match(init.headers?.authorization || '', /^Bearer TOKEN/)
    if ((init.method || 'GET') === 'GET') return jsonRes({ state: s.state, rev: s.rev })
    const body = JSON.parse(init.body)
    s.puts.push(body)
    if (body.baseRev !== s.rev) return jsonRes({ error: 'conflict', rev: s.rev, state: s.state }, { status: 409 })
    s.state = { ...body.state, _rev: s.rev + 1 }; s.rev++
    return jsonRes({ ok: true, rev: s.rev })
  }
  return s
}

/** Runs the Sunday command with scripted answers, in a sandbox that never touches the real out/, token or backups. */
async function sunday({ answers, o = {}, paired = 'TOKEN-123', items = week, srvOpts }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-week-'))
  const env = { BRIDGE_OUT_DIR: path.join(dir, 'out'), OPENGYM_TOKEN_FILE: path.join(dir, 'token.json'), BRIDGE_BACKUP_DIR: path.join(dir, 'backups') }
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  fs.mkdirSync(env.BRIDGE_OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(env.BRIDGE_OUT_DIR, 'week-raw.json'), JSON.stringify({ gym: { name: 'x' }, items }))
  if (paired) saveToken(env.OPENGYM_TOKEN_FILE, { baseUrl: BASE, token: paired })
  const srv = pretendServer(srvOpts)
  const asked = [], say = []
  const realFetch = globalThis.fetch, realLog = console.log
  globalThis.fetch = srv.fetch
  console.log = (...a) => say.push(a.join(' '))
  try {
    await cmdWeek({ 'skip-fetch': true, 'week-of': '2026-10-05', ...o }, { ask: async q => { asked.push(q); return answers.shift() ?? '' } })
  } finally {
    globalThis.fetch = realFetch; console.log = realLog
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
  return { srv, asked, say: say.join('\n'), dir, token: read('token.json'), state: read('out/state.json'), backups: fs.existsSync(env.BRIDGE_BACKUP_DIR) ? fs.readdirSync(env.BRIDGE_BACKUP_DIR) : [] }
}

test('week: plans, previews, and writes the three class routines after one "y"', async () => {
  const r = await sunday({ answers: ['n', 'y'] })                      // no free workout, yes to writing
  assert.deepEqual(r.srv.state.routines.map(x => x.id), ['mine', 'ahw-2026-10-06-hyrox', 'ahw-2026-10-07-crossfit', 'ahw-2026-10-08-hyrox'])
  assert.deepEqual(Object.keys(r.srv.state.dayPlan).sort(), ['2026-10-06', '2026-10-07', '2026-10-08'])
  assert.deepEqual(r.srv.state.workouts, [{ id: 'w1', d: '2026-09-28' }], 'your logged workouts are untouched')
  assert.equal(r.backups.length, 1, 'a backup of the state before the write')
  assert.equal(r.state?.lastFree, undefined)
  assert.match(r.say, /DRY RUN — nothing written/)
  assert.match(r.say, /WRITTEN/)
  assert.match(r.say, /read back from openGym: all present/)
})

test('week: an answer other than yes writes nothing', async () => {
  const r = await sunday({ answers: ['n', 'n'] })
  assert.equal(r.srv.puts.length, 0)
  assert.deepEqual(r.backups, [])
  assert.match(r.say, /Nothing was written/)
})

test('week: the free workout is only created when you say yes, and it is remembered for the next rotation', async () => {
  const r = await sunday({ answers: ['y', 'y'] })
  const freeRoutine = r.srv.state.routines.find(x => x.id.startsWith('ahf-'))
  assert.ok(freeRoutine, 'free routine created')
  assert.ok(r.srv.state.dayPlan['2026-10-05'], 'on the free day (Monday)')
  assert.ok(['upper', 'legs'].includes(r.state?.lastFree))
  const asked = r.asked.join(' | ')
  assert.match(asked, /Also create the free workout/)
})

test('week: nothing is asked or written when none of your classes is published yet', async () => {
  const r = await sunday({ answers: [], o: { 'week-of': '2026-10-12' } })
  assert.equal(r.asked.length, 0)
  assert.equal(r.srv.puts.length, 0)
  assert.match(r.say, /nothing to write/)
})

test('week: the first time it pairs inline and keeps the token for the next Sunday', async () => {
  const r = await sunday({ paired: null, answers: [BASE, 'ABC123', 'n', 'y'] })
  assert.equal(r.srv.pairs, 1)
  assert.equal(r.token.token, 'TOKEN-NEW')
  assert.equal(r.token.baseUrl, BASE)
  assert.equal(r.srv.state.routines.length, 4)
})

test('week: an expired pairing is replaced on the spot (only the code is asked), then it carries on', async () => {
  const r = await sunday({ paired: 'TOKEN-OLD', srvOpts: { rejectToken: 'TOKEN-OLD' }, answers: ['n', 'ABC123', 'y'] })
  assert.match(r.say, /did not accept the saved pairing/)
  assert.equal(r.token.token, 'TOKEN-NEW')
  assert.equal(r.srv.state.routines.length, 4)
  assert.ok(!r.asked.some(q => /address/i.test(q)), 'it reuses the saved address')
})

test('week: --skip drops a class from the plan and from what is written', async () => {
  const r = await sunday({ answers: ['n', 'y'], o: { skip: 'thu' } })
  assert.deepEqual(r.srv.state.routines.map(x => x.id), ['mine', 'ahw-2026-10-06-hyrox', 'ahw-2026-10-07-crossfit'])
})
