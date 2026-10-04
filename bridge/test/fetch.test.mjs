import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cmdFetch } from '../src/cli.mjs'
import { jsonRes, textRes } from './helpers.mjs'
import { week, pub } from './fixtures/week.mjs'

// The feed holds this week (5 Oct) and the one before (28 Sep): Tue Hyrox, Wed CrossFit and a Saturday.
const lastWeek = [
  pub({ id: 9001, date: '2026-09-29', wodClass: 'Hyrox', blocks: [{ notes: 'HYROX' }, { title: '3 RFT', notes: 'x' }] }),
  pub({ id: 9002, date: '2026-09-30', blocks: [{ title: 'EMOM', notes: 'x' }] }),
  pub({ id: 9003, date: '2026-10-03', blocks: [{ title: 'For time', notes: 'x' }] }),   // a Saturday: never selected
]
const feed = [...week, ...lastWeek]

function fakeAimharder(posts) {
  const log = { details: 0 }
  const impl = async (url, init = {}) => {
    const u = new URL(url)
    if (u.pathname === '/api/login') return jsonRes({ data: { auth: { authOK: true } } }, { cookies: ['amhrdrauth=S; Path=/'] })
    if (u.pathname === '/api/whoami') return jsonRes({ data: [{ roles: [{ role: 'client', centre_url: 'mybox.aimharder.es', gym: 'My Box' }] }] })
    if (u.hostname === 'mybox.aimharder.es' && u.pathname === '/') return textRes('<script>x={timeLineContent: 7, userID: 1}</script>')
    if (u.pathname === '/api/activity') return jsonRes({ elements: posts.map(p => p.post) })
    if (u.pathname === '/api/activity/workout') { log.details++; const hit = posts.find(p => String(p.post.id) === u.searchParams.get('SEID')); return hit ? jsonRes(hit.detail) : jsonRes({}, { status: 404 }) }
    return jsonRes({}, { status: 404 })
  }
  return { impl, log }
}

async function runFetch(o, posts = feed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-fetch-'))
  const saved = { BRIDGE_OUT_DIR: process.env.BRIDGE_OUT_DIR, AIMHARDER_USER: process.env.AIMHARDER_USER, AIMHARDER_PASSWORD: process.env.AIMHARDER_PASSWORD }
  Object.assign(process.env, { BRIDGE_OUT_DIR: dir, AIMHARDER_USER: 'sara@example.com', AIMHARDER_PASSWORD: 'pw' })
  const fake = fakeAimharder(posts), say = []
  const realFetch = globalThis.fetch, realLog = console.log, realErr = process.stderr.write.bind(process.stderr)
  globalThis.fetch = fake.impl; console.log = (...a) => say.push(a.join(' ')); process.stderr.write = () => true
  try { await cmdFetch(o) } finally {
    globalThis.fetch = realFetch; console.log = realLog; process.stderr.write = realErr
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'week-raw.json'), 'utf8'))
  return { out, say: say.join('\n'), fake, ids: out.items.map(i => i.post.id).sort() }
}

test('fetch keeps one week only: the selected classes of the week asked for', async () => {
  const r = await runFetch({ 'week-of': '2026-10-05' })
  assert.deepEqual(r.ids, [9101, 9201, 9301])                 // Tue Hyrox, Wed CrossFit, Thu Hyrox of that week
  assert.equal(r.out.weekOf, '2026-10-05')
  assert.match(r.say, /Kept 3 for the week of Mon 5 Oct/)
})

test('fetch can look at an earlier week, and still keeps nothing from the others', async () => {
  const r = await runFetch({ 'week-of': '2026-09-28' })
  assert.deepEqual(r.ids, [9001, 9002])                       // the Saturday and the other week are gone
})

test('a week that is not published yet leaves nothing on disk and says what the newest week is', async () => {
  const r = await runFetch({ 'week-of': '2026-10-12' })
  assert.deepEqual(r.ids, [])
  assert.match(r.say, /Nothing is published yet for that week \(the newest publications are for the week of Mon 5 Oct\)/)
})

test('the previous file is replaced, never added to', async () => {
  const first = await runFetch({ 'week-of': '2026-10-05' })
  assert.equal(first.out.items.length, 3)
  const second = await runFetch({ 'week-of': '2026-10-12' })
  assert.equal(second.out.items.length, 0)
})

test('without --week-of it reads only the newest publications; --max-posts overrides', async () => {
  const many = Array.from({ length: 30 }, (_, i) => pub({ id: 8000 + i, date: '2026-09-22', blocks: [{ title: 'EMOM', notes: 'x' }] }))
  const def = await runFetch({ 'max-posts': undefined, 'week-of': undefined }, many).catch(e => e)
  assert.ok(!(def instanceof Error))
  assert.equal(def.fake.log.details, 18)
  const two = await runFetch({ 'max-posts': '2' }, many)
  assert.equal(two.fake.log.details, 2)
  const dated = await runFetch({ 'week-of': '2026-09-21' }, many)
  assert.equal(dated.fake.log.details, 30, 'an explicit older week looks deeper')
})

test('--week-of must be a Monday', async () => {
  await assert.rejects(runFetch({ 'week-of': '2026-10-06' }), /must be a Monday/)
})
