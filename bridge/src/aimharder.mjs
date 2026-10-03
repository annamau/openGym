// Minimal Aimharder client: login, find your gym, read the published workouts.
//
// There is no official API. This uses the same JSON endpoints the Aimharder web app calls, as
// reverse-engineered by aimharder-mcp (MIT, github.com/rudeayelo/aimharder-mcp) and fitbot-mcp. It
// is READ-ONLY: it never books, cancels or posts anything. It can stop working whenever Aimharder
// changes its site, and it fails loudly (never silently returning "nothing") when that happens.
//
// Safety rules kept from the projects it learns from:
//  - credentials come from the caller and are only ever sent to aimharder.es / aimharder.com
//  - redirects are refused, responses are size-limited, requests time out
//  - one automatic re-login per run, then stop (no retry loops against a login endpoint)
//  - error messages never contain response bodies, cookies or credentials

import { randomBytes } from 'node:crypto'
import { sleep } from './util.mjs'
import { inventory } from './parse.mjs'

export class AimharderError extends Error {
  constructor(code, message) { super(message || code); this.name = 'AimharderError'; this.code = code }
}

const HOST_OK = /(^|\.)aimharder\.(es|com)$/
const GYM_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.aimharder\.(es|com)$/
const MAX_BYTES = 2_000_000

export class AimharderClient {
  #cookies = new Map()
  #relogged = false
  #creds
  #fetch
  #timeoutMs
  domain

  constructor({ username, password, domain = 'aimharder.es', fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    if (!username || !password) throw new AimharderError('NO_CREDENTIALS', 'username and password are required')
    if (!/^aimharder\.(es|com)$/.test(domain)) throw new AimharderError('BAD_DOMAIN', 'domain must be aimharder.es or aimharder.com')
    this.#creds = { username, password }
    this.#fetch = fetchImpl
    this.#timeoutMs = timeoutMs
    this.domain = domain
  }

  async #send(url, { method = 'GET', json, text = false } = {}) {
    const u = new URL(url)
    if (u.protocol !== 'https:' || !HOST_OK.test(u.hostname)) throw new AimharderError('BAD_HOST', 'refusing to contact ' + u.hostname)
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    if (this.#cookies.size) headers.Cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(this.#timeoutMs) }
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json) }

    let res
    try { res = await this.#fetch(u, init) } catch { throw new AimharderError('NETWORK', `could not reach ${u.hostname}`) }
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';')
      const i = pair.indexOf('=')
      if (i < 1) continue
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim()
      const gone = attrs.some(a => /^\s*max-age\s*=\s*0\s*$/i.test(a)) || value === ''
      if (gone) this.#cookies.delete(name); else this.#cookies.set(name, value)
    }
    if (res.status === 401) throw new AimharderError('UNAUTHORIZED', 'login rejected or session expired')
    if (res.status === 403 || res.status === 429) throw new AimharderError('RESTRICTED', `Aimharder refused the request (HTTP ${res.status}) — it may be blocking automated access`)
    if (res.status >= 300 && res.status < 400) throw new AimharderError('REDIRECT', `unexpected redirect from ${u.hostname}`)
    if (!res.ok) throw new AimharderError('HTTP', `HTTP ${res.status} from ${u.hostname}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new AimharderError('TOO_BIG', 'response too large')
    const body = buf.toString('utf8')
    if (text) return body
    let data
    try { data = JSON.parse(body) } catch { throw new AimharderError('NOT_JSON', `unexpected (non-JSON) response from ${u.pathname}`) }
    if (data && data.logout === 1) throw new AimharderError('UNAUTHORIZED', 'session expired')
    return data
  }

  async login() {
    this.#cookies.clear()
    const data = await this.#send(`https://login.${this.domain}/api/login`, {
      method: 'POST',
      json: { username: this.#creds.username, password: this.#creds.password, iniframe: 0, fingerprint: randomBytes(25).toString('hex') },
    }).catch(e => {
      if (e.code === 'UNAUTHORIZED') throw new AimharderError('AUTH_FAILED', 'login failed — check the email/password (and whether the account needs extra verification)')
      throw e
    })
    if (data?.data?.auth?.authOK !== true || !this.#cookies.has('amhrdrauth')) {
      throw new AimharderError('AUTH_FAILED', 'login failed — check the email/password (and whether the account needs extra verification)')
    }
  }

  /** One request with a single automatic re-login if the session expired. */
  async #authed(url, opts) {
    try { return await this.#send(url, opts) } catch (e) {
      if (e.code !== 'UNAUTHORIZED' || this.#relogged) throw e
      this.#relogged = true
      await this.login()
      return this.#send(url, opts)
    }
  }

  /** The gyms (boxes) this account belongs to: [{ host, id, name }]. */
  async gyms() {
    const data = await this.#authed(`https://${this.domain}/api/whoami`)
    const roles = data?.data?.[0]?.roles
    if (!Array.isArray(roles)) throw new AimharderError('UNEXPECTED_SHAPE', 'whoami did not return memberships')
    const out = new Map()
    for (const r of roles) {
      if (r?.role !== 'client' || !GYM_HOST.test(String(r.centre_url ?? ''))) continue
      out.set(r.centre_url, { host: r.centre_url, id: r.centre_url.split('.')[0], name: String(r.gym ?? '') })
    }
    if (!out.size) throw new AimharderError('NO_GYMS', 'no client memberships found on this account')
    return [...out.values()]
  }

  /** The numeric id of the account that publishes the gym's workouts (found on the gym's home page). */
  async publisher(host) {
    const html = await this.#authed(`https://${host}/`, { text: true })
    const ids = [...String(html).matchAll(/timeLineContent:\s*7,\s*userID:\s*(\d+)/g)].map(m => Number(m[1]))
    if (!ids.length || ids.some(id => id !== ids[0]) || !Number.isSafeInteger(ids[0])) {
      throw new AimharderError('NO_PUBLISHER', 'could not find the workout feed on the gym page (site layout may have changed)')
    }
    return ids[0]
  }

  async feed(host, publisher) {
    const q = new URLSearchParams({ timeLineFormat: '0', timeLineContent: '7', userID: String(publisher) })
    const data = await this.#authed(`https://${host}/api/activity?${q}`)
    if (!Array.isArray(data?.elements)) throw new AimharderError('UNEXPECTED_SHAPE', 'the workout feed had an unexpected shape')
    return data.elements.filter(p => p && Number.isSafeInteger(p.id))
  }

  async detail(host, id) {
    return this.#authed(`https://${host}/api/activity/workout?SEID=${encodeURIComponent(id)}`)
  }

  /**
   * Everything the gym has published that we can read: posts plus details.
   * Only the first page of the feed is read (what Aimharder shows by default); callers must treat
   * "not found" as "not seen", never as "not published".
   */
  async fetchPublished({ gymId, maxPosts = 40, delayMs = 250, onProgress } = {}) {
    await this.login()
    const gyms = await this.gyms()
    let gym = gyms[0]
    if (gymId) gym = gyms.find(g => g.id === gymId)
    else if (gyms.length > 1) throw new AimharderError('MANY_GYMS', 'several gyms on this account — choose one with --gym: ' + gyms.map(g => g.id).join(', '))
    if (!gym) throw new AimharderError('NO_GYMS', 'that gym is not on this account')

    const publisher = await this.publisher(gym.host)
    const posts = await this.feed(gym.host, publisher)
    const considered = posts.filter(p => p.wodClass != null || Array.isArray(p.TIPOWODs)).slice(0, maxPosts)
    const items = []
    for (const [i, post] of considered.entries()) {
      onProgress?.({ i: i + 1, of: considered.length })
      items.push({ post, detail: await this.detail(gym.host, post.id) })
      if (delayMs && i < considered.length - 1) await sleep(delayMs)
    }
    return {
      gym: { id: gym.id, name: gym.name },
      feedSize: posts.length,
      skippedNonWorkout: posts.length - considered.length,
      items,
      inventory: {
        post: inventory(posts),
        detail: inventory(items.map(x => x.detail)),
        block: inventory(items.flatMap(x => x.detail?.TIPOWODs ?? [])),
        exercise: inventory(items.flatMap(x => x.detail?.ejerRate ?? [])),
      },
    }
  }
}
