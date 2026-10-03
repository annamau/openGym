import test from 'node:test'
import assert from 'node:assert/strict'
import { AimharderClient, AimharderError } from '../src/aimharder.mjs'
import { jsonRes, textRes } from './helpers.mjs'
import { week } from './fixtures/week.mjs'

const PASSWORD = 'correct horse battery staple'

/** A pretend Aimharder: records every request, checks the login, serves the fixture week. */
function fake({ logoutOnce = false, logoutAlways = false, goodPassword = PASSWORD } = {}) {
  const log = { requests: [], logins: 0 }
  let logouts = 0
  const impl = async (url, init = {}) => {
    const u = new URL(url)
    log.requests.push({ url: String(u), method: init.method || 'GET', headers: init.headers || {}, body: init.body })
    if (u.pathname === '/api/login') {
      log.logins++
      const body = JSON.parse(init.body)
      if (body.password !== goodPassword) return jsonRes({ data: { auth: { authOK: false } } })
      return jsonRes({ data: { auth: { authOK: true } } }, { cookies: ['amhrdrauth=SESSION1; Path=/; HttpOnly'] })
    }
    if ((logoutOnce && logouts === 0) || logoutAlways) { logouts++; return jsonRes({ logout: 1 }) }
    if (u.pathname === '/api/whoami') return jsonRes({ data: [{ roles: [{ role: 'client', centre_url: 'mybox.aimharder.es', gym: 'My Box' }, { role: 'client', centre_url: 'evil.example.com', gym: 'Nope' }] }] })
    if (u.hostname === 'mybox.aimharder.es' && u.pathname === '/') return textRes('<script>x={timeLineContent: 7, userID: 4242}</script>')
    if (u.pathname === '/api/activity') return jsonRes({ elements: [...week.map(w => w.post), { id: 5555, notAWorkout: true }] })
    if (u.pathname === '/api/activity/workout') {
      const hit = week.find(w => String(w.post.id) === u.searchParams.get('SEID'))
      return hit ? jsonRes(hit.detail) : jsonRes({}, { status: 404 })
    }
    return jsonRes({}, { status: 404 })
  }
  return { impl, log }
}
const client = (f, over = {}) => new AimharderClient({ username: 'sara@example.com', password: PASSWORD, fetchImpl: f.impl, ...over })

test('reads the gym, the feed and every workout, and skips non-workout posts', async () => {
  const f = fake()
  const r = await client(f).fetchPublished({ delayMs: 0 })
  assert.equal(r.gym.id, 'mybox')
  assert.equal(r.items.length, 6)
  assert.equal(r.skippedNonWorkout, 1)
  assert.equal(r.items[0].detail.recordDate, '6 de Octubre de 2026')
  assert.ok(r.inventory.detail.recordDate)
})

test('the password is sent only in the login body; later requests carry the session cookie only', async () => {
  const f = fake()
  await client(f).fetchPublished({ delayMs: 0 })
  for (const q of f.log.requests) {
    const hasPassword = JSON.stringify(q).includes(PASSWORD)
    assert.equal(hasPassword, q.url.includes('/api/login'), q.url)
  }
  const later = f.log.requests.find(q => q.url.includes('/api/whoami'))
  assert.match(later.headers.Cookie, /amhrdrauth=SESSION1/)
})

test('it never sends anything but GET after login (read-only)', async () => {
  const f = fake()
  await client(f).fetchPublished({ delayMs: 0 })
  assert.deepEqual([...new Set(f.log.requests.filter(q => !q.url.includes('/api/login')).map(q => q.method))], ['GET'])
})

test('a wrong password is reported without echoing the password', async () => {
  const f = fake({ goodPassword: 'something else' })
  await assert.rejects(() => client(f).login(), e => e instanceof AimharderError && e.code === 'AUTH_FAILED' && !e.message.includes(PASSWORD))
})

test('only aimharder.es / aimharder.com are ever contacted', async () => {
  const f = fake()
  const c = client(f)
  await c.login()
  await assert.rejects(() => c.detail('evil.example.com', 1), e => e.code === 'BAD_HOST')
  await assert.rejects(() => c.detail('aimharder.es.evil.com', 1), e => e.code === 'BAD_HOST')
  assert.throws(() => new AimharderClient({ username: 'a', password: 'b', domain: 'evil.com' }), /domain must be/)
  assert.ok(!f.log.requests.some(q => q.url.includes('evil')))
})

test('gym hosts outside aimharder are ignored when listing memberships', async () => {
  const f = fake()
  const c = client(f)
  await c.login()
  const gyms = await c.gyms()
  assert.deepEqual(gyms.map(g => g.host), ['mybox.aimharder.es'])
})

test('one automatic re-login when the session expires, then stop', async () => {
  const once = fake({ logoutOnce: true })
  const r = await client(once).fetchPublished({ delayMs: 0 })
  assert.equal(r.items.length, 6)
  assert.equal(once.log.logins, 2)
  const always = fake({ logoutAlways: true })
  await assert.rejects(() => client(always).fetchPublished({ delayMs: 0 }), e => e.code === 'UNAUTHORIZED')
  assert.ok(always.log.logins <= 3, `logins ${always.log.logins}`)
})

test('redirects and oversized responses are refused', async () => {
  const redirect = async () => new Response('', { status: 302, headers: { location: 'https://evil.com' } })
  await assert.rejects(() => new AimharderClient({ username: 'a', password: 'b', fetchImpl: redirect }).login(), e => ['REDIRECT', 'AUTH_FAILED'].includes(e.code))
  const huge = async () => new Response('x'.repeat(2_100_000), { status: 200 })
  await assert.rejects(() => new AimharderClient({ username: 'a', password: 'b', fetchImpl: huge }).login(), e => e.code === 'TOO_BIG')
})

test('a changed site layout fails loudly instead of returning "nothing"', async () => {
  const f = fake()
  const impl = async (url, init) => new URL(url).pathname === '/' ? textRes('<html>new design</html>') : f.impl(url, init)
  await assert.rejects(() => client({ impl }).fetchPublished({ delayMs: 0 }), e => e.code === 'NO_PUBLISHER')
})
