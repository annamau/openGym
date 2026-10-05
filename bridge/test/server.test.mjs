import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ui-'))
process.env.BRIDGE_OUT_DIR = path.join(tmp, 'out')
process.env.BRIDGE_EXTRAS_FILE = path.join(tmp, 'extras.json')
process.env.OPENGYM_TOKEN_FILE = path.join(tmp, 'token.json')
delete process.env.AIMHARDER_USER; delete process.env.AIMHARDER_PASSWORD

const { createServer } = await import('../src/server.mjs')
let srv, base, host
before(async () => { srv = createServer(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); host = `127.0.0.1:${srv.address().port}`; base = `http://${host}` })
after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }) })

const call = (method, p, body, headers = {}) => fetch(base + p, {
  method, headers: { origin: base, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
})
const run = { title: 'Easy run 5 km', type: 'run', date: '2026-10-06', time: '07:30', detail: 'Zone 2', tags: ['z2'] }

test('serves the page and refuses foreign hosts', async () => {
  assert.equal((await call('GET', '/')).status, 200)
  const status = await new Promise((ok, no) => http.get({ host: '127.0.0.1', port: srv.address().port, path: '/', headers: { host: 'evil.example' } }, r => { r.resume(); ok(r.statusCode) }).on('error', no))
  assert.equal(status, 403)
  assert.equal((await call('GET', '/../src/cli.mjs')).status, 404)
})

test('state-changing requests must come from the UI itself', async () => {
  assert.equal((await call('POST', '/api/sessions', run, { origin: 'http://evil.example' })).status, 403)
  assert.equal((await call('POST', '/api/sessions', run, { origin: '' })).status, 403)
})

test('running plan / other workouts: create, edit, list, delete', async () => {
  const made = await (await call('POST', '/api/sessions', run)).json()
  assert.match(made.id, /^x-/)
  const edited = await (await call('PUT', `/api/sessions/${made.id}`, { ...run, title: 'Tempo run 8 km' })).json()
  assert.equal(edited.title, 'Tempo run 8 km')
  const list = await (await call('GET', '/api/sessions?from=2026-10-05&to=2026-10-11')).json()
  assert.deepEqual(list.map(s => s.title), ['Tempo run 8 km'])
  assert.equal((await call('DELETE', `/api/sessions/${made.id}`)).status, 200)
  assert.equal((await (await call('GET', '/api/sessions')).json()).length, 0)
})

test('rejects bad input and the class types', async () => {
  for (const bad of [{ ...run, title: '' }, { ...run, type: 'class' }, { ...run, date: '2026-13-40' }, { ...run, time: '25:00' }]) {
    assert.equal((await call('POST', '/api/sessions', bad)).status, 400)
  }
})

test('Aimharder workouts are read-only', async () => {
  fs.mkdirSync(process.env.BRIDGE_OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(process.env.BRIDGE_OUT_DIR, 'proposal.json'), JSON.stringify({
    classes: [{ date: '2026-10-07', routine: { id: 'ahw-2026-10-07-crossfit', name: 'CrossFit · Wed 7 Oct', ex: [1, 2] } }], free: null,
  }))
  const list = await (await call('GET', '/api/sessions')).json()
  assert.equal(list[0].readOnly, true)
  assert.equal((await call('PUT', '/api/sessions/ahw-2026-10-07-crossfit', run)).status, 403)
  assert.equal((await call('DELETE', '/api/sessions/ahw-2026-10-07-crossfit')).status, 403)
})

test('class selection is saved as a this-week override', async () => {
  const sel = { mon: 'none', tue: 'crossfit', wed: 'none', thu: 'hyrox', fri: 'none', sat: 'none', sun: 'none' }
  const saved = await (await call('POST', '/api/class-selection', sel)).json()
  assert.deepEqual(saved.selection, { tue: 'crossfit', thu: 'hyrox' })
  assert.equal(saved.overridden, true)
  assert.equal((await call('POST', '/api/class-selection', { tue: 'yoga' })).status, 400)
})

test('sync without credentials explains what to do and never prompts', async () => {
  const r = await call('POST', '/api/sync')
  assert.equal(r.status, 400)
  assert.match((await r.json()).error, /\.env/)
})
