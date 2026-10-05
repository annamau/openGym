#!/usr/bin/env node
// Local web UI for the bridge: `npm run ui` -> http://localhost:4173
//
// Same rules as the CLI: it runs on your computer, has no dependencies, never writes to openGym
// unless you press "Write to openGym", and the Aimharder password comes from .env (never from the browser).
//
// Safety: it listens on 127.0.0.1 only, answers only to Host localhost/127.0.0.1, and refuses state-changing
// requests that do not come from its own page (Origin check), so another website cannot drive it.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEnv, envPresence } from './env.mjs'
import { cmdFetch, cmdPlan, cmdApply, defaultMonday } from './cli.mjs'
import { loadToken } from './opengym.mjs'
import { DAYS, todayIso } from './util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UI_DIR = path.join(ROOT, 'ui')
const outDir = () => process.env.BRIDGE_OUT_DIR ? path.resolve(process.env.BRIDGE_OUT_DIR) : path.join(ROOT, 'out')
const extrasFile = () => process.env.BRIDGE_EXTRAS_FILE ? path.resolve(process.env.BRIDGE_EXTRAS_FILE) : path.join(ROOT, 'config', 'extras.local.json')
const tokenFile = () => process.env.OPENGYM_TOKEN_FILE ? path.resolve(process.env.OPENGYM_TOKEN_FILE) : path.join(ROOT, '.opengym-token.json')
const weekSelFile = () => path.join(outDir(), 'week-selection.json')
const proposalFile = () => path.join(outDir(), 'proposal.json')

const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return dflt } }
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)) }
const selectionConfig = () => readJson(path.join(ROOT, 'config', 'selection.json'), { defaults: {} })

class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }

// ---- your own sessions (running plan, other workouts): local file, never sent anywhere -----------------------

const EDITABLE_TYPES = new Set(['run', 'other'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function cleanSession(b) {
  const bad = m => { throw new HttpError(400, m) }
  if (!b || typeof b !== 'object') bad('invalid body')
  const title = String(b.title ?? '').trim()
  if (!title || title.length > 120) bad('title is required (max 120 characters)')
  if (!EDITABLE_TYPES.has(b.type)) bad('only Running and Other workouts can be edited here')
  if (!ISO_DATE.test(b.date ?? '') || Number.isNaN(Date.parse(b.date))) bad('invalid date')
  if (!ISO_TIME.test(b.time ?? '')) bad('invalid time')
  const detail = String(b.detail ?? '').trim()
  if (detail.length > 2000) bad('description too long')
  const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean) : []
  if (tags.length > 20 || tags.some(t => t.length > 40)) bad('too many or too long tags')
  return { title, type: b.type, date: b.date, time: b.time, detail, tags }
}

const readExtras = () => { const x = readJson(extrasFile(), []); return Array.isArray(x) ? x : [] }

// ---- what the bridge planned (read only) ----------------------------------------------------------------------

const hh = h => String(h).padStart(2, '0') + ':00'

function plannedSessions() {
  const p = readJson(proposalFile(), null)
  if (!p) return []
  const sel = selectionConfig()
  const cls = (p.classes || []).map(c => ({
    id: c.routine.id, date: c.date, time: hh(sel.classHour ?? 7), title: c.routine.name, type: 'class', readOnly: true,
    detail: `${c.routine.ex.length} exercises · from Aimharder`,
  }))
  const free = p.free ? [{
    id: p.free.routine.id, date: p.free.date, time: hh(sel.freeHour ?? 7), title: p.free.routine.name, type: 'free', readOnly: true,
    detail: `${p.free.routine.ex.length} exercises · suggested free workout`,
  }] : []
  return [...cls, ...free]
}

// ---- class selection: the defaults, plus an override that only applies to one week ----------------------------

function selectionState() {
  const defaults = selectionConfig().defaults || {}
  const weekOf = defaultMonday(todayIso())
  const saved = readJson(weekSelFile(), null)
  const overridden = saved?.weekOf === weekOf && saved.selection && typeof saved.selection === 'object'
  return { weekOf, defaults, selection: overridden ? saved.selection : defaults, overridden }
}

function cleanSelection(b) {
  const out = {}
  for (const d of DAYS) {
    const v = b?.[d]
    if (v === undefined || v === 'none') continue
    if (v !== 'crossfit' && v !== 'hyrox') throw new HttpError(400, `invalid class for ${d}`)
    out[d] = v
  }
  return out
}

/** CLI options that make fetch/plan/apply use this week's selection. */
function weekOptions() {
  const { defaults, selection } = selectionState()
  const entries = Object.entries(selection)
  if (entries.length) return { select: entries.map(([d, c]) => `${d}=${c}`).join(',') }
  return { skip: Object.keys(defaults).join(',') || undefined }   // nothing selected: skip every default day
}

// ---- running the CLI steps with their console output captured -------------------------------------------------

let busy = false
async function captured(fn) {
  if (busy) throw new HttpError(409, 'Another sync is already running.')
  busy = true
  const lines = [], keep = { log: console.log, error: console.error, write: process.stderr.write }
  console.log = (...a) => { lines.push(a.join(' ')) }
  console.error = (...a) => { lines.push(a.join(' ')) }
  process.stderr.write = () => true
  try { await fn(lines); return { ok: true, log: lines.join('\n') } }
  catch (e) { return { ok: false, error: e.message, log: lines.join('\n') } }
  finally { Object.assign(console, { log: keep.log, error: keep.error }); process.stderr.write = keep.write; busy = false }
}

function needCredentials() {
  const p = envPresence(['AIMHARDER_USER', 'AIMHARDER_PASSWORD'])
  if (!p.AIMHARDER_USER || !p.AIMHARDER_PASSWORD) {
    throw new HttpError(400, 'Aimharder credentials missing: copy bridge/.env.example to bridge/.env and fill in AIMHARDER_USER and AIMHARDER_PASSWORD, then restart the UI.')
  }
}

// ---- HTTP -----------------------------------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

async function body(req) {
  let size = 0; const chunks = []
  for await (const c of req) { size += c.length; if (size > 100_000) throw new HttpError(413, 'request too large'); chunks.push(c) }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'invalid JSON') }
}

async function api(req, url) {
  const m = req.method, p = url.pathname
  if (p === '/api/status') {
    return {
      aimharder: envPresence(['AIMHARDER_USER', 'AIMHARDER_PASSWORD']), paired: !!loadToken(tokenFile()),
      hasPlan: fs.existsSync(proposalFile()), ...selectionState(),
    }
  }
  if (p === '/api/sessions' && m === 'GET') {
    const from = url.searchParams.get('from') || '0000-00-00', to = url.searchParams.get('to') || '9999-99-99'
    return [...plannedSessions(), ...readExtras()].filter(s => s.date >= from && s.date <= to)
  }
  if (p === '/api/sessions' && m === 'POST') {
    const s = { id: 'x-' + randomUUID().slice(0, 8), ...cleanSession(await body(req)) }
    writeJson(extrasFile(), [...readExtras(), s]); return s
  }
  const one = /^\/api\/sessions\/([\w-]+)$/.exec(p)
  if (one && (m === 'PUT' || m === 'DELETE')) {
    const all = readExtras(), i = all.findIndex(x => x.id === one[1])
    if (i < 0) throw new HttpError(one[1].startsWith('ahw-') || one[1].startsWith('ahf-') ? 403 : 404, one[1].startsWith('ahw-') || one[1].startsWith('ahf-') ? 'Aimharder workouts are read-only' : 'not found')
    if (m === 'DELETE') all.splice(i, 1); else all[i] = { id: all[i].id, ...cleanSession(await body(req)) }
    writeJson(extrasFile(), all); return m === 'DELETE' ? { ok: true } : all[i]
  }
  if (p === '/api/progress' && m === 'GET') {
    const d = readJson(path.join(ROOT, 'config', 'progress.local.json'), null)
    if (!d) throw new HttpError(404, 'No Garmin data saved yet: ask Claude to refresh the Garmin progress.')
    return d
  }
  if (p === '/api/garmin/refresh' && m === 'POST') {
    const uv = process.env.UV_BIN || (fs.existsSync('/opt/homebrew/bin/uv') ? '/opt/homebrew/bin/uv' : 'uv')
    return new Promise((resolve, reject) => execFile(uv, ['run', '--python', '3.12', '--with', 'garminconnect', path.join(ROOT, 'scripts', 'garmin_refresh.py')],
      { cwd: ROOT, timeout: 180_000 }, (err, out, errOut) => {
        const log = `${out || ''}${errOut || ''}`.trim()
        if (!err) return resolve({ ok: true, log: log.split('\n').pop() })
        reject(new HttpError(/NOT_CONNECTED/.test(log) ? 401 : 500, /NOT_CONNECTED/.test(log) ? 'NOT_CONNECTED' : (log.split('\n').slice(-2).join(' ') || 'Garmin refresh failed')))
      }))
  }
  if (p === '/api/class-selection' && m === 'GET') return selectionState()
  if (p === '/api/class-selection' && m === 'POST') {
    const selection = cleanSelection(await body(req)), { weekOf } = selectionState()
    writeJson(weekSelFile(), { weekOf, selection }); return selectionState()
  }
  if (p === '/api/sync' && m === 'POST') {
    needCredentials()
    const o = weekOptions(), tok = loadToken(tokenFile())
    return captured(async lines => {
      await cmdFetch(o)
      lines.push('\n--- plan ---'); cmdPlan(o)
      if (tok) { lines.push('\n--- what would be written to openGym (dry run, nothing written yet) ---'); await cmdApply({ ...o, yes: false, 'with-free': true, fromWeek: true }) }
      else lines.push('\nNot paired with openGym yet: run "node src/cli.mjs pair" once in a terminal, then use "Write to openGym".')
    })
  }
  if (p === '/api/apply' && m === 'POST') {
    const { withFree } = await body(req)
    if (!fs.existsSync(proposalFile())) throw new HttpError(400, 'Nothing planned yet: run "Sync with Aimharder" first.')
    return captured(() => cmdApply({ ...weekOptions(), yes: true, 'with-free': !!withFree, fromWeek: true }))
  }
  throw new HttpError(404, 'not found')
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'" })
      res.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data))
    }
    try {
      const host = String(req.headers.host || '')
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new HttpError(403, 'forbidden host')
      const url = new URL(req.url, `http://${host}`)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers.origin !== `http://${host}`) throw new HttpError(403, 'forbidden origin')
      }
      if (url.pathname.startsWith('/api/')) return send(200, await api(req, url))
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed')
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
      const file = path.resolve(UI_DIR, rel)
      if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'not found')
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream')
    } catch (e) {
      send(e.status || 500, { error: e.status ? e.message : 'internal error' })
      if (!e.status && process.env.DEBUG) console.error(e.stack)
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv(path.join(ROOT, '.env'))
  const port = Number(process.env.BRIDGE_PORT || 4173)
  createServer().listen(port, '127.0.0.1', () => {
    const missing = Object.entries(envPresence(['AIMHARDER_USER', 'AIMHARDER_PASSWORD'])).filter(([, v]) => !v).map(([k]) => k)
    console.log(`openGym bridge UI: http://localhost:${port}  (Ctrl+C to stop)`)
    if (missing.length) console.log(`Note: ${missing.join(', ')} not set in bridge/.env — "Sync with Aimharder" will not work until they are.`)
  })
}
