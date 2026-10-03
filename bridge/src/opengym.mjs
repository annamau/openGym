// Talks to your openGym server over its own HTTP API, the way the phone app does: a one-time
// pairing code (Settings → Pair the mobile app) is redeemed for a Bearer token, stored locally.
//
// What this file will and will not do to your data:
//  - it adds or refreshes ONLY routines whose id starts with "ahw-" (class workouts) and the
//    custom exercises it created ("ahx-"); your own routines are never edited;
//  - your free routines ("ahf-") are created once and then left alone, so the weights and
//    progression you build on them are never overwritten;
//  - it schedules a date only when that date is empty or already holds one of its own routines;
//  - every write is preceded by a full backup, uses the revision check, and is read back.

import fs from 'node:fs'
import path from 'node:path'
import { norm } from './util.mjs'

export class OpenGymError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra) }
}

const isOwned = id => typeof id === 'string' && (id.startsWith('ahw-') || id.startsWith('ahf-'))

export function checkBaseUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new OpenGymError('BAD_URL', `Not a valid address: ${raw}`) }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new OpenGymError('BAD_URL', 'The openGym address must start with https:// (the token is a credential).')
  return u.origin
}

export class OpenGymClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
    this.base = checkBaseUrl(baseUrl)
    this.token = token
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async #req(method, route, body, auth = true) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (auth) headers.authorization = `Bearer ${this.token}`
    const res = await this.fetch(this.base + route, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
    })
    let data = null
    try { data = await res.json() } catch { /* empty body */ }
    return { status: res.status, data }
  }

  async getData() {
    const { status, data } = await this.#req('GET', '/api/data')
    if (status === 401) throw new OpenGymError('UNAUTHORIZED', 'openGym did not accept the saved token. Run "pair" again.')
    if (status !== 200) throw new OpenGymError('HTTP', `openGym answered ${status} when reading your data.`)
    return { state: data?.state ?? null, rev: data?.rev ?? 0 }
  }

  async putData(state, baseRev) {
    const { status, data } = await this.#req('PUT', '/api/data', { state, baseRev })
    if (status === 409) return { conflict: true, rev: data?.rev, state: data?.state }
    if (status === 401) throw new OpenGymError('UNAUTHORIZED', 'openGym did not accept the saved token. Run "pair" again.')
    if (status !== 200 || !data?.ok) throw new OpenGymError('HTTP', `openGym answered ${status} when saving.`)
    return { ok: true, rev: data.rev }
  }
}

export async function redeemPairingCode(baseUrl, code, fetchImpl = globalThis.fetch) {
  const base = checkBaseUrl(baseUrl)
  const res = await fetchImpl(base + '/api/pair/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: String(code).trim() }),
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  if (res.status !== 200 || !data?.token) throw new OpenGymError('PAIR', 'That pairing code was not accepted (they expire after 5 minutes). Generate a new one in Settings.')
  return { baseUrl: base, token: data.token, user: data.user?.name ?? null }
}

export function saveToken(file, info) {
  fs.writeFileSync(file, JSON.stringify({ baseUrl: info.baseUrl, token: info.token, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* not supported on this platform */ }
}
export function loadToken(file) {
  if (!fs.existsSync(file)) return null
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j.baseUrl && j.token ? j : null } catch { return null }
}

/**
 * Pure: the new state plus a report of what was done and what was left alone.
 * plan = { routines: [...], free: [...], customEx: [...], schedule: { 'YYYY-MM-DD': routineId } }
 */
export function applyChanges(state, plan) {
  const next = structuredClone(state)
  next.routines = Array.isArray(next.routines) ? next.routines : []
  next.customEx = Array.isArray(next.customEx) ? next.customEx : []
  next.dayPlan = next.dayPlan && typeof next.dayPlan === 'object' ? next.dayPlan : {}
  const report = { added: [], refreshed: [], kept: [], customAdded: [], scheduled: [], skippedDays: [] }
  const idFor = new Map() // planned routine id -> id actually used in the app

  for (const r of plan.routines || []) {
    const i = next.routines.findIndex(x => x.id === r.id)
    if (i >= 0) { next.routines[i] = r; report.refreshed.push(r.id) } else { next.routines.push(r); report.added.push(r.id) }
    idFor.set(r.id, r.id)
  }
  for (const r of plan.free || []) {
    const byId = next.routines.find(x => x.id === r.id)
    const byName = next.routines.find(x => norm(x.name) === norm(r.name))
    const found = byId || byName
    if (found) { report.kept.push(`${r.name} (already exists as ${found.id})`); idFor.set(r.id, found.id) }
    else { next.routines.push(r); report.added.push(r.id); idFor.set(r.id, r.id) }
  }
  for (const c of plan.customEx || []) {
    const i = next.customEx.findIndex(x => x.id === c.id)
    if (i < 0) { next.customEx.push(c); report.customAdded.push(c.id) }
    else if (String(c.id).startsWith('ahx-')) next.customEx[i] = c
  }
  for (const [iso, plannedId] of Object.entries(plan.schedule || {})) {
    const id = idFor.get(plannedId) ?? plannedId
    const existing = next.dayPlan[iso]
    if (existing === undefined || existing === id || isOwned(existing)) { next.dayPlan[iso] = id; report.scheduled.push({ iso, id }) }
    else report.skippedDays.push({ iso, wanted: id, existing })
  }
  return { next, report }
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') }

/** Backup → apply → conditional write (one retry on conflict) → read back. */
export async function syncToOpenGym({ client, plan, backupDir, dryRun = true, force = false, now = Date.now }) {
  const first = await client.getData()
  if (!first.state) throw new OpenGymError('NO_STATE', 'openGym has no data for this account yet. Open the app and sign in once first.')
  const { next, report } = applyChanges(first.state, plan)
  if (dryRun) return { dryRun: true, report, rev: first.rev }

  const age = now() - (first.state._ts || 0)
  if (!force && age >= 0 && age < 120000) {
    throw new OpenGymError('BUSY', 'Your openGym data changed in the last 2 minutes, so the app may be open and in use. Close it (or wait) and retry, or pass --force.')
  }
  fs.mkdirSync(backupDir, { recursive: true })
  const backup = path.join(backupDir, `state-rev${first.rev}-${stamp()}.json`)
  fs.writeFileSync(backup, JSON.stringify(first.state))

  let current = first, attempt = { next, report }
  for (let tries = 0; tries < 2; tries++) {
    attempt.next._ts = now()
    const res = await client.putData(attempt.next, current.rev)
    if (res.ok) {
      const back = await client.getData()
      const verify = verifyApplied(back.state, plan, attempt.report)
      return { dryRun: false, report: attempt.report, backup, rev: res.rev, verified: verify.ok, problems: verify.problems }
    }
    if (tries === 1) break
    // Someone else wrote in between: re-apply on top of what is there now. applyChanges is idempotent.
    current = res.state ? { state: res.state, rev: res.rev } : await client.getData()
    attempt = applyChanges(current.state, plan)
  }
  throw new OpenGymError('CONFLICT', 'openGym kept changing while saving (two conflicts in a row). Nothing was lost; run it again.', { backup })
}

export function verifyApplied(state, plan, report) {
  const problems = []
  const ids = new Set((state?.routines || []).map(r => r.id))
  for (const id of [...report.added, ...report.refreshed]) if (!ids.has(id)) problems.push(`routine ${id} missing after save`)
  for (const s of report.scheduled) if (state?.dayPlan?.[s.iso] !== s.id) problems.push(`${s.iso} not scheduled after save`)
  return { ok: problems.length === 0, problems }
}
