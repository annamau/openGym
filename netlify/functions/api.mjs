import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';

export const config = {
  path: '/api/*'
};

const RP_NAME = process.env.RP_NAME || 'openGym';
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);

// In-memory fallback for local testing when Netlify Blobs credentials are not present
const memStore = new Map();

function getGymStore() {
  try {
    return getStore('gym-data', { consistency: 'strong' });
  } catch {
    return null;
  }
}

async function blobGet(key, type = 'json') {
  const store = getGymStore();
  if (store) {
    try {
      const val = await store.get(key, { type });
      if (val !== undefined && val !== null) return val;
    } catch {
      // Fall through to memory store if blob call fails
    }
  }
  const val = memStore.get(key);
  if (val === undefined || val === null) return null;
  if (type === 'json' && typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  return val;
}

async function blobSet(key, value, isJson = false) {
  const store = getGymStore();
  const serialized = isJson ? JSON.stringify(value) : value;
  memStore.set(key, serialized);
  if (store) {
    try {
      if (isJson) await store.setJSON(key, value);
      else await store.set(key, String(value));
    } catch (err) {
      console.warn('Netlify Blobs write warning:', err.message);
    }
  }
}

async function blobDelete(key) {
  const store = getGymStore();
  memStore.delete(key);
  if (store) {
    try {
      await store.delete(key);
    } catch {}
  }
}

/* ---------- Database helpers ---------- */
async function getDb() {
  const db = await blobGet('db', 'json');
  return db || { users: [], creds: [], subs: [], invites: [] };
}

async function saveDb(db) {
  await blobSet('db', db, true);
}

async function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = await blobGet('secret', 'text');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    await blobSet('secret', s, false);
  }
  return s;
}

async function getVapid(origin) {
  let vapid = await blobGet('vapid', 'json');
  if (!vapid || !vapid.publicKey || !vapid.privateKey) {
    vapid = webpush.generateVAPIDKeys();
    await blobSet('vapid', vapid, true);
  }
  try {
    const subject = process.env.VAPID_SUBJECT || (origin ? origin : 'mailto:admin@localhost');
    webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  } catch {}
  return vapid;
}

async function readState(uid) {
  const cleanId = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  return await blobGet('state-' + cleanId, 'json');
}

async function writeState(uid, state) {
  const cleanId = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  await blobSet('state-' + cleanId, state, true);
}

async function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  await blobSet('challenge:' + cid, { ...data, exp: Date.now() + 5 * 60000 }, true);
  return cid;
}

async function takeChallenge(cid) {
  if (!cid) return null;
  const key = 'challenge:' + cid;
  const c = await blobGet(key, 'json');
  if (c) blobDelete(key).catch(() => {});
  if (!c || c.exp < Date.now()) return null;
  return c;
}

async function makePairCode(uid) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.randomBytes(8)).map(b => chars[b % chars.length]).join('');
  await blobSet('pairing:' + code, { uid, exp: Date.now() + 5 * 60000 }, true);
  return code;
}

async function redeemPairCode(code) {
  const key = 'pairing:' + String(code).trim().toUpperCase();
  const p = await blobGet(key, 'json');
  if (p) blobDelete(key).catch(() => {});
  if (!p || p.exp < Date.now()) return null;
  return p.uid;
}

/* ---------- Sessions & Security ---------- */
const sessionVersion = user => user.sv || 0;
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));

function signToken(payload, secret) {
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function verifySig(token, secret) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  return payload;
}

function makeSessionToken(user, secret) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return signToken(`${user.id}:${exp}:${sessionVersion(user)}`, secret);
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return map;
}

async function readSession(req, db, secret) {
  const auth = req.headers.get('authorization') || '';
  const cookies = parseCookies(req.headers.get('cookie'));
  const tok = cookies['__Host-gymsid'] || cookies['gymsid'] || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
  if (!tok) return null;
  const payload = verifySig(tok, secret);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid);
  if (!user || user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}

function sessionCookies(user, secret, isSecure) {
  const token = makeSessionToken(user, secret);
  const maxAge = SESSION_DAYS * 86400;
  const sec = isSecure ? ' Secure;' : '';
  const c1 = `__Host-gymsid=${token}; Path=/; Max-Age=${maxAge}; HttpOnly;${sec} SameSite=Lax`;
  const c2 = `gymsid=${token}; Path=/; Max-Age=${maxAge}; HttpOnly;${sec} SameSite=Lax`;
  return isSecure ? [c1, `gymsid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`] : [c2];
}

function clearCookies(isSecure) {
  const sec = isSecure ? ' Secure;' : '';
  return [
    `__Host-gymsid=; Path=/; Max-Age=0; HttpOnly;${sec} SameSite=Lax`,
    `gymsid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  ];
}

function jsonResponse(data, status = 200, extraHeaders = {}, cookies = []) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }
  for (const c of cookies) {
    headers.append('Set-Cookie', c);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function text(v) {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const records = v => (Array.isArray(v) ? v.filter(record) : []);

/* ---------- Main Handler ---------- */
export default async function handler(req) {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname.startsWith('/.netlify/functions/api')) {
    pathname = pathname.replace('/.netlify/functions/api', '/api');
  }

  // Handle CORS & Preflight
  const reqOrigin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    const corsHeaders = new Headers({
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    if (reqOrigin) {
      corsHeaders.set('Access-Control-Allow-Origin', reqOrigin);
      corsHeaders.set('Vary', 'Origin');
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost';
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const isSecure = proto === 'https';
  const calculatedOrigin = `${proto}://${host}`;
  const origin = reqOrigin || process.env.ORIGIN || calculatedOrigin;
  const rpID = process.env.RP_ID || host.split(':')[0];

  const db = await getDb();
  const secret = await getSecret();
  const vapid = await getVapid(origin);

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const key = req.method.toUpperCase() + ' ' + pathname;

  try {
    // 1. Health & Config
    if (key === 'GET /api/health') {
      return jsonResponse({ ok: true, users: db.users.length, mode: 'netlify-blob' });
    }

    if (key === 'GET /api/config') {
      return jsonResponse({
        invite_only: INVITE_ONLY,
        allow_guest: ALLOW_GUEST
      });
    }

    // 2. Who am I
    if (key === 'GET /api/me') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      return jsonResponse({ user: { id: user.id, name: user.name, admin: isAdmin(user) } });
    }

    // 3. WebAuthn Registration
    if (key === 'POST /api/register/options') {
      const name = text(body.name).trim().slice(0, 40);
      if (!name) return jsonResponse({ error: 'name required' }, 400);

      const code = text(body.code).trim().toUpperCase();
      if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked)) {
        return jsonResponse({ error: 'a valid invite code is required' }, 403);
      }

      const uid = crypto.randomBytes(12).toString('base64url');
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userID: Buffer.from(uid),
        userName: name,
        userDisplayName: name,
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        excludeCredentials: []
      });

      const cid = await putChallenge({ challenge: options.challenge, name, uid, code });
      return jsonResponse({ cid, options });
    }

    if (key === 'POST /api/register/verify') {
      const c = await takeChallenge(body.cid);
      if (!c || !c.uid) {
        return jsonResponse({ error: 'challenge expired — try again' }, 400);
      }

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: body.credential,
          expectedChallenge: c.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: false
        });
      } catch (e) {
        return jsonResponse({ error: e.message || 'verification failed' }, 400);
      }

      if (!verification.verified) {
        return jsonResponse({ error: 'not verified' }, 400);
      }

      const info = verification.registrationInfo || {};
      const cred = info.credential || {};
      const credId = cred.id || info.credentialID;
      const credPubKey = cred.publicKey || info.credentialPublicKey;
      const credCounter = cred.counter ?? info.counter ?? 0;

      if (db.creds.find(x => x.id === credId)) {
        return jsonResponse({ error: 'credential already registered' }, 409);
      }

      let invite = null;
      if (INVITE_ONLY && c.code) {
        invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
        if (!invite) return jsonResponse({ error: 'invite code is no longer valid' }, 403);
      }

      const user = {
        id: c.uid,
        name: c.name,
        created: new Date().toISOString(),
        admin: db.users.length === 0 || ADMIN_UIDS.includes(c.uid)
      };

      if (invite) {
        user.invitedBy = invite.code;
        invite.usedBy = user.id;
        invite.usedAt = user.created;
      }

      db.users.push(user);
      db.creds.push({
        id: credId,
        userId: user.id,
        publicKey: Buffer.from(credPubKey).toString('base64url'),
        counter: credCounter,
        transports: body.credential?.response?.transports || []
      });
      await saveDb(db);

      const cookies = sessionCookies(user, secret, isSecure);
      return jsonResponse(
        { user: { id: user.id, name: user.name, admin: isAdmin(user) } },
        200,
        {},
        cookies
      );
    }

    // 4. WebAuthn Authentication (Login)
    if (key === 'POST /api/login/options') {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred',
        allowCredentials: []
      });
      const cid = await putChallenge({ challenge: options.challenge });
      return jsonResponse({ cid, options });
    }

    if (key === 'POST /api/login/verify') {
      const c = await takeChallenge(body.cid);
      if (!c) return jsonResponse({ error: 'challenge expired — try again' }, 400);

      const cred = db.creds.find(x => x.id === body.credential?.id);
      if (!cred) return jsonResponse({ error: 'unknown passkey — create a profile first' }, 404);

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.credential,
          expectedChallenge: c.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: false,
          credential: {
            id: cred.id,
            publicKey: Buffer.from(cred.publicKey, 'base64url'),
            counter: cred.counter,
            transports: cred.transports
          }
        });
      } catch (e) {
        return jsonResponse({ error: e.message || 'verification failed' }, 400);
      }

      if (!verification.verified) {
        return jsonResponse({ error: 'not verified' }, 400);
      }

      cred.counter = verification.authenticationInfo.newCounter;
      await saveDb(db);

      const user = db.users.find(u => u.id === cred.userId);
      if (!user) return jsonResponse({ error: 'user missing' }, 500);
      if (user.disabled) return jsonResponse({ error: 'this account has been disabled' }, 403);

      const cookies = sessionCookies(user, secret, isSecure);
      return jsonResponse(
        { user: { id: user.id, name: user.name, admin: isAdmin(user) } },
        200,
        {},
        cookies
      );
    }

    // 5. Logout
    if (key === 'POST /api/logout') {
      return jsonResponse({ ok: true }, 200, {}, clearCookies(isSecure));
    }

    if (key === 'POST /api/logout/all') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      user.sv = sessionVersion(user) + 1;
      await saveDb(db);
      return jsonResponse({ ok: true }, 200, {}, clearCookies(isSecure));
    }

    // 6. Workout Data Sync
    if (key === 'GET /api/data') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const state = await readState(user.id);
      return jsonResponse({ state, rev: state?._rev || 0 });
    }

    if (key === 'GET /api/data/rev') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const state = await readState(user.id);
      return jsonResponse({ rev: state?._rev || 0 });
    }

    if (key === 'PUT /api/data') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);

      if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
        return jsonResponse({ error: 'state required' }, 400);
      }

      const list = v => v == null || Array.isArray(v);
      if (!list(body.state.workouts) || !list(body.state.routines)) {
        return jsonResponse({ error: 'invalid state' }, 400);
      }

      for (const k of ['workouts', 'routines']) {
        if (Array.isArray(body.state[k])) body.state[k] = records(body.state[k]);
      }

      const cur = await readState(user.id);
      const curRev = cur?._rev || 0;
      if (body.baseRev != null && body.baseRev !== curRev) {
        return jsonResponse({ error: 'conflict', rev: curRev, state: cur }, 409);
      }

      delete body.state.active;
      body.state._rev = curRev + 1;
      await writeState(user.id, body.state);

      return jsonResponse({ ok: true, ts: body.state._ts || null, rev: body.state._rev });
    }

    // 7. Device Pairing (Mobile App)
    if (key === 'POST /api/pair/create') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const code = await makePairCode(user.id);
      return jsonResponse({ code });
    }

    if (key === 'POST /api/pair/redeem') {
      const code = text(body.code).trim().toUpperCase();
      const uid = await redeemPairCode(code);
      if (!uid) return jsonResponse({ error: 'invalid or expired code' }, 400);
      const user = db.users.find(u => u.id === uid);
      if (!user || user.disabled) return jsonResponse({ error: 'invalid or expired code' }, 400);
      const token = makeSessionToken(user, secret);
      return jsonResponse({ token, user: { id: user.id, name: user.name, admin: isAdmin(user) } });
    }

    // 8. Push Notifications
    if (key === 'GET /api/push/public-key') {
      return jsonResponse({ key: vapid.publicKey });
    }

    if (key === 'POST /api/push/subscribe') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const sub = body.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return jsonResponse({ error: 'invalid subscription' }, 400);
      }
      db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
      db.subs.push({
        userId: user.id,
        endpoint: sub.endpoint,
        keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) },
        deviceId: text(body.deviceId) || undefined,
        created: new Date().toISOString()
      });
      await saveDb(db);
      return jsonResponse({ ok: true });
    }

    if (key === 'GET /api/push/status') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const endpoint = url.searchParams.get('endpoint') || '';
      return jsonResponse({ subscribed: db.subs.some(s => s.userId === user.id && s.endpoint === endpoint) });
    }

    if (key === 'POST /api/push/unsubscribe') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
      await saveDb(db);
      return jsonResponse({ ok: true });
    }

    if (key === 'POST /api/push/test') {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      const subs = db.subs.filter(s => s.userId === user.id);
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            JSON.stringify({ title: 'openGym', body: 'Push notifications are working!' })
          );
        } catch {}
      }
      return jsonResponse({ ok: true });
    }

    if (key === 'POST /api/push/rest-timer' || key === 'POST /api/push/rest-timer/cancel' || key === 'POST /api/activity') {
      return jsonResponse({ ok: true });
    }

    // 9. Admin Endpoints
    if (pathname.startsWith('/api/admin/')) {
      const user = await readSession(req, db, secret);
      if (!user) return jsonResponse({ error: 'not signed in' }, 401);
      if (!isAdmin(user)) return jsonResponse({ error: 'forbidden' }, 403);

      if (key === 'GET /api/admin/users') {
        const users = await Promise.all(
          db.users.map(async u => {
            const S = (await readState(u.id)) || {};
            const workouts = records(S.workouts);
            const last = workouts[workouts.length - 1];
            return {
              id: u.id,
              name: u.name,
              created: u.created || null,
              disabled: !!u.disabled,
              admin: isAdmin(u),
              invitedBy: u.invitedBy || null,
              workouts: workouts.length,
              lastWorkout: last ? last.d : null,
              lastSync: S._ts || null,
              hasPush: db.subs.some(s => s.userId === u.id),
              live: null
            };
          })
        );
        return jsonResponse({ users, invite_only: INVITE_ONLY, now: Date.now() });
      }

      if (key === 'GET /api/admin/invites') {
        return jsonResponse({ invites: db.invites, invite_only: INVITE_ONLY });
      }

      if (key === 'POST /api/admin/invites/new') {
        const newCode = crypto.randomBytes(8).toString('hex').toUpperCase();
        const inv = {
          code: newCode,
          note: text(body.note).slice(0, 60),
          createdBy: user.id,
          created: new Date().toISOString()
        };
        db.invites.push(inv);
        await saveDb(db);
        return jsonResponse({ invite: inv });
      }

      if (key === 'POST /api/admin/invites/revoke') {
        const code = text(body.code).toUpperCase();
        db.invites = db.invites.filter(i => i.code !== code);
        await saveDb(db);
        return jsonResponse({ ok: true });
      }

      if (key === 'POST /api/admin/user/disable') {
        const target = db.users.find(x => x.id === body.id);
        if (!target) return jsonResponse({ error: 'no such user' }, 404);
        if (isAdmin(target)) return jsonResponse({ error: 'cannot disable an admin' }, 400);
        target.disabled = !!body.disabled;
        await saveDb(db);
        return jsonResponse({ ok: true, id: target.id, disabled: target.disabled });
      }

      if (key === 'POST /api/admin/user/delete') {
        const target = db.users.find(x => x.id === body.id);
        if (!target) return jsonResponse({ error: 'no such user' }, 404);
        if (target.id === user.id) return jsonResponse({ error: 'you cannot delete your own account' }, 400);
        db.users = db.users.filter(x => x.id !== target.id);
        db.creds = db.creds.filter(c => c.userId !== target.id);
        db.subs = db.subs.filter(s => s.userId !== target.id);
        await blobDelete('state-' + target.id);
        await saveDb(db);
        return jsonResponse({ ok: true, id: target.id });
      }
    }

    return jsonResponse({ error: 'not found: ' + key }, 404);
  } catch (err) {
    console.error('API Error:', key, err);
    return jsonResponse({ error: 'server error' }, 500);
  }
}
