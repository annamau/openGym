#!/usr/bin/env node
// openGym bridge: Aimharder class workouts -> analysis -> openGym routines.
//
//   npm run week                      THE SUNDAY COMMAND: fetch -> plan -> preview -> asks before writing to openGym
//   node src/cli.mjs fetch            read the published workouts (read-only); keeps only the classes you selected
//   node src/cli.mjs plan             analyse the week offline and propose the free workout (also saves out/plan.txt)
//   node src/cli.mjs clean            delete everything in out/week-raw.json that is not a selected class
//   node src/cli.mjs pair             store a token for your openGym (one-time code from Settings)
//   node src/cli.mjs apply            show what would be written; add --yes to write it

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { AimharderClient, AimharderError } from './aimharder.mjs'
import { normalizeWorkout, classify, DEFAULT_RULES } from './parse.mjs'
import { weekDates, parseSelect, applySelection, resolveWeek, pruneItems } from './select.mjs'
import { buildRoutine } from './routine.mjs'
import { catalogue } from './appbridge.mjs'
import { analyzeWeek } from './analyze.mjs'
import { buildFreeMenu, recommendFree } from './free.mjs'
import { renderPlan } from './report.mjs'
import { OpenGymClient, OpenGymError, redeemPairingCode, saveToken, loadToken, syncToOpenGym } from './opengym.mjs'
import { ask } from './prompt.mjs'
import { DAYS, DAY_LONG, addDays, mondayOf, todayIso, weekdayOf, prettyDate, norm } from './util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.resolve(ROOT, ...a)   // an absolute path (e.g. --out) is used as given
// Where this run keeps its files. Tests point these elsewhere so they never touch your real out/ or token.
const outFile = (...a) => path.join(process.env.BRIDGE_OUT_DIR ? path.resolve(process.env.BRIDGE_OUT_DIR) : P('out'), ...a)
const tokenFile = () => process.env.OPENGYM_TOKEN_FILE ? path.resolve(process.env.OPENGYM_TOKEN_FILE) : P('.opengym-token.json')
const rawFileOf = o => (o.out ? P(o.out) : outFile('week-raw.json'))
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)) }

const SENSITIVE = /mail|phone|telef|^tel$|^tel[_-]|[_-]tel$|token|pass|cookie|auth|session|dni|nif|iban|address|birth/i
export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE.test(k)).map(([k, x]) => [k, scrub(x)]))
  return v
}

/** On Saturday/Sunday the week that matters is the one that starts tomorrow/Monday. */
export function defaultMonday(today) {
  const wd = weekdayOf(today)
  return wd === 6 || wd === 0 ? addDays(mondayOf(today), 7) : mondayOf(today)
}

const OPTIONS = {
  'week-of': { type: 'string' }, out: { type: 'string' }, domain: { type: 'string' }, gym: { type: 'string' },
  select: { type: 'string' }, skip: { type: 'string' }, add: { type: 'string' }, pick: { type: 'string' },
  free: { type: 'string' }, 'last-free': { type: 'string' }, 'no-free': { type: 'boolean' },
  demo: { type: 'boolean' }, yes: { type: 'boolean' }, 'with-free': { type: 'boolean' }, force: { type: 'boolean' },
  url: { type: 'string' }, code: { type: 'string' }, 'max-posts': { type: 'string' }, 'skip-fetch': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
}

const HELP = `
openGym bridge

  week    [--skip-fetch] [--skip thu] [--select ...] [--free upper|legs|none]   THE SUNDAY COMMAND (also: npm run week)
  fetch   [--week-of YYYY-MM-DD] [--domain aimharder.es] [--gym ID] [--select ...]   (keeps one week, only your selected classes; the rest is not saved)
  clean   [--select ...] [--week-of ...]         (deletes from out/week-raw.json everything that is not a selected class, or not that week)
  plan    [--week-of YYYY-MM-DD] [--select tue=hyrox,wed=crossfit] [--skip thu] [--add fri=crossfit]
          [--pick wed=<publication id>] [--free upper|legs|none] [--last-free upper|legs] [--demo]
  pair    --url https://your-site.netlify.app [--code ABC123]
  apply   [--with-free] [--yes] [--force]

Credentials: AIMHARDER_USER / AIMHARDER_PASSWORD, or you are asked (the password is hidden).
Nothing is written to openGym unless "apply" is run with --yes.
`

/** The classes you attend: the defaults, adjusted by --select / --skip / --add. */
function selectionFrom(o, sel) {
  const selection = applySelection(sel.defaults, {
    select: o.select ? parseSelect(o.select) : undefined,
    skip: o.skip ? o.skip.split(',').map(x => x.trim()) : [],
    add: o.add ? parseSelect(o.add) : undefined,
  })
  const note = o.select ? 'from --select' : (o.skip || o.add) ? 'defaults adjusted by --skip/--add' : 'defaults'
  return { selection, note }
}

const stateFile = () => outFile('state.json')
const readState = () => { try { return readJson(stateFile()) } catch { return {} } }
const writeState = patch => writeJson(stateFile(), { ...readState(), ...patch })

function loadConfig() {
  return { sel: readJson(P('config', 'selection.json')), targets: readJson(P('config', 'targets.json')) }
}

function readWorkouts(rawFile) {
  const raw = readJson(rawFile)
  const workouts = [], unreadable = []
  for (const it of raw.items || []) {
    const n = normalizeWorkout(it.post, it.detail)
    if (n.ok) workouts.push(n.workout); else unreadable.push(n.reason)
  }
  return { raw, workouts, unreadable }
}

/** The week this run is about: --week-of, else the upcoming Monday on a weekend and this week's Monday otherwise. */
function targetWeek(o) {
  const weekOf = o['week-of'] || defaultMonday(todayIso())
  if (weekdayOf(weekOf) !== 1) throw new Error(`--week-of must be a Monday (${weekOf} is not)`)
  return weekOf
}

export async function cmdFetch(o) {
  const weekOf = targetWeek(o)
  const username = process.env.AIMHARDER_USER || await ask('Aimharder email or username: ')
  const password = process.env.AIMHARDER_PASSWORD || await ask('Aimharder password (hidden): ', { hidden: true })
  const client = new AimharderClient({ username, password, domain: o.domain || process.env.AIMHARDER_DOMAIN || 'aimharder.es' })
  // The newest publications come first, so the latest week is within the first ~18; an older week needs a deeper look.
  const result = await client.fetchPublished({
    gymId: o.gym, maxPosts: Number(o['max-posts'] || (o['week-of'] ? 40 : 18)),
    onProgress: ({ i, of }) => process.stderr.write(`\r  reading publication ${i}/${of}   `),
  })
  process.stderr.write('\n')
  const { sel } = loadConfig()
  const { selection } = selectionFrom(o, sel)
  const rules = sel.rules || DEFAULT_RULES
  const file = rawFileOf(o)
  // Only the classes you attend, for this one week, are kept; the rest of the feed is never written to disk.
  const { kept, dropped } = pruneItems(result.items, selection, rules, { weekOf })
  writeJson(file, scrub({ fetchedAt: new Date().toISOString(), gym: result.gym, weekOf, selection, items: kept }))
  const { workouts, unreadable } = readWorkouts(file)
  const classes = Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(', ')
  console.log(`Gym: ${result.gym.name}. ${result.items.length} workout publications read (feed had ${result.feedSize}).`)
  console.log(`Kept ${kept.length} for the week of ${DAY_LONG.mon} ${prettyDate(weekOf)}: only your selected classes (${classes}). The other ${dropped} were not saved.`)
  for (const w of workouts.sort((a, b) => a.date.localeCompare(b.date))) console.log(`  ${w.date} ${DAY_LONG[DAYS[(weekdayOf(w.date) + 6) % 7]]}  ${classify(w, rules)} [${w.sourceId}] ${w.exercises.length} exercises`)
  if (!kept.length) {
    const dates = result.items.map(it => normalizeWorkout(it.post, it.detail)).filter(n => n.ok).map(n => n.workout.date).sort()
    console.log(`  Nothing is published yet for that week${dates.length ? ` (the newest publications are for the week of ${DAY_LONG.mon} ${prettyDate(mondayOf(dates.at(-1)))})` : ''}. The gym usually uploads on Sunday around 8pm; run it again then.`)
  }
  if (unreadable.length) console.log(`  could not read ${unreadable.length}: ${[...new Set(unreadable)].join('; ')}`)
  console.log(`\nSaved ${path.relative(process.cwd(), file)} (email/phone/token-like fields removed). If you change the selection, run fetch again.`)
}

function cmdClean(o) {
  const { sel } = loadConfig()
  const { selection } = selectionFrom(o, sel)
  const file = rawFileOf(o)
  if (!fs.existsSync(file)) return console.log('No week-raw.json to clean.')
  const raw = readJson(file)
  const weekOf = o['week-of'] ? targetWeek(o) : undefined       // clean keeps every week unless you name one
  const { kept, dropped } = pruneItems(raw.items, selection, sel.rules || DEFAULT_RULES, { weekOf })
  writeJson(file, scrub({ fetchedAt: raw.fetchedAt, gym: raw.gym, ...(weekOf ? { weekOf } : {}), selection, items: kept }))
  console.log(`Kept ${kept.length} publication(s) for ${Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(', ')}; deleted ${dropped} that were not selected.`)
}

function cmdPlan(o) {
  const { sel, targets } = loadConfig()
  const rawFile = o.demo ? P('test', 'fixtures', 'week-demo.json') : rawFileOf(o)
  if (!fs.existsSync(rawFile)) throw new Error('No week-raw.json yet. Run "fetch" first (or "plan --demo" to see a sample).')
  const { workouts, unreadable } = readWorkouts(rawFile)
  const weekOf = o['week-of'] || (o.demo ? '2026-10-05' : defaultMonday(todayIso()))
  if (weekdayOf(weekOf) !== 1) throw new Error(`--week-of must be a Monday (${weekOf} is not)`)
  const dates = weekDates(weekOf)
  const datesList = DAYS.map(d => dates[d])

  const { selection, note: selectionNote } = selectionFrom(o, sel)

  const picks = Object.fromEntries((o.pick || '').split(',').filter(Boolean).map(p => p.split('=').map(s => s.trim())))
  const resolved = resolveWeek(workouts, selection, dates, sel.rules || DEFAULT_RULES).map(r => {
    if (r.status === 'ambiguous' && picks[r.day]) {
      const hit = r.candidates.find(c => String(c.sourceId) === picks[r.day])
      if (hit) return { day: r.day, date: r.date, cls: r.cls, status: 'ok', workout: hit }
    }
    return r
  })

  const built = []
  for (const r of resolved.filter(x => x.status === 'ok')) {
    const b = buildRoutine(r.workout, r.cls, { catalogue })
    built.push({ date: r.date, cls: r.cls, day: r.day, ...b })
  }
  const classes = built.map(b => ({ date: b.date, cls: b.cls, routine: b.routine, customEx: b.customEx, effort: b.effort, stimulus: b.stimulus }))

  const menu = buildFreeMenu(P('config', 'free'), sel.free)
  const base = analyzeWeek({ dates: datesList, classes, free: null, targets, selection: sel })
  const freeRec = recommendFree({ menu, sessions: base.sessions, targets, selection: sel, dates: datesList, lastFree: o['last-free'] ?? readState().lastFree })
  let choice = null
  if (!o['no-free'] && o.free !== 'none') {
    if (o.free) {
      if (!menu[o.free]) throw new Error(`--free must be one of: ${Object.keys(menu).join(', ')}, none`)
      choice = { key: o.free, forced: true }
    } else if (freeRec.chosen) choice = { key: freeRec.chosen.key }
  }
  const freeDate = dates[sel.freeDay]
  const final = analyzeWeek({
    dates: datesList, classes, targets, selection: sel,
    free: choice ? { date: freeDate, routine: menu[choice.key].routine, customEx: menu[choice.key].customEx } : null,
  })

  const nameOf = (id, customEx) => customEx.find(c => c.id === id)?.n ?? catalogue.get(id)?.n ?? id
  const text = renderPlan({ weekOf, selection, selectionNote, resolved, built, analysis: final, freeRec, freeChoice: choice, menu, targets, unreadable, nameOf })
  console.log(text)

  const proposal = {
    createdAt: new Date().toISOString(), weekOf, selection,
    classes: built.map(b => ({ date: b.date, day: b.day, cls: b.cls, routine: b.routine, customEx: b.customEx, unresolved: b.unresolved, warnings: b.warnings })),
    free: choice ? { key: choice.key, date: freeDate, routine: menu[choice.key].routine, customEx: menu[choice.key].customEx, options: freeRec.options.map(({ key, score, gain, penalty, rotation }) => ({ key, score, gain, penalty, rotation })) } : null,
    notFound: resolved.filter(r => r.status !== 'ok').map(r => ({ day: r.day, date: r.date, cls: r.cls, status: r.status })),
  }
  if (!o.demo) {
    writeJson(outFile('proposal.json'), proposal)
    fs.writeFileSync(outFile('plan.txt'), text + '\n')
    console.log('\nSaved out/plan.txt (this report, to read in VS Code) and out/proposal.json (what apply would write). Nothing has been sent to openGym.')
  }
  else console.log('\n(demo: sample data, nothing saved)')
}

async function cmdPair(o) {
  const url = o.url || await ask('Your openGym address (https://…): ')
  const code = o.code || await ask('Pairing code from Settings → Pair the mobile app: ')
  const info = await redeemPairingCode(url, code)
  saveToken(tokenFile(), info)
  console.log(`Paired${info.user ? ' as ' + info.user : ''}. Token saved to ${path.basename(tokenFile())} (kept out of git, valid for the server's session length).`)
}

async function cmdApply(o) {
  const file = outFile('proposal.json')
  if (!fs.existsSync(file)) throw new Error('No out/proposal.json. Run "plan" first.')
  const proposal = readJson(file)
  const tok = loadToken(tokenFile())
  if (!tok) throw new Error('Not paired yet. Run "pair" first.')
  const withFree = !!o['with-free'] && proposal.free
  const plan = {
    routines: proposal.classes.map(c => c.routine),
    free: withFree ? [proposal.free.routine] : [],
    customEx: [...proposal.classes.flatMap(c => c.customEx), ...(withFree ? proposal.free.customEx : [])],
    schedule: { ...Object.fromEntries(proposal.classes.map(c => [c.date, c.routine.id])), ...(withFree ? { [proposal.free.date]: proposal.free.routine.id } : {}) },
  }
  const client = new OpenGymClient({ baseUrl: tok.baseUrl, token: tok.token })
  const res = await syncToOpenGym({ client, plan, backupDir: process.env.BRIDGE_BACKUP_DIR ? path.resolve(process.env.BRIDGE_BACKUP_DIR) : P('backups'), dryRun: !o.yes, force: !!o.force })
  const r = res.report
  console.log(res.dryRun ? 'DRY RUN — nothing written.' : `WRITTEN (revision ${res.rev}). Backup: ${path.relative(process.cwd(), res.backup)}`)
  console.log(`  new routines:        ${r.added.join(', ') || '—'}`)
  console.log(`  refreshed routines:  ${r.refreshed.join(', ') || '—'}`)
  console.log(`  kept as they were:   ${r.kept.join(', ') || '—'}`)
  console.log(`  new custom exercises: ${r.customAdded.join(', ') || '—'}`)
  console.log(`  scheduled:           ${r.scheduled.map(s => `${s.iso} → ${s.id}`).join(', ') || '—'}`)
  for (const s of r.skippedDays) console.log(`  NOT scheduled ${s.iso}: that day already has "${s.existing}" in your plan`)
  if (proposal.free && !withFree && !o.fromWeek) console.log(`  (free workout "${proposal.free.routine.name}" not included; add --with-free once you approve it)`)
  if (proposal.notFound.length) console.log(`  days with no workout yet: ${proposal.notFound.map(n => `${n.day} ${n.cls} [${n.status}]`).join(', ')}`)
  if (!res.dryRun && withFree && res.verified) writeState({ lastFree: proposal.free.key, lastFreeDate: proposal.free.date })
  if (!res.dryRun) console.log(res.verified ? '  read back from openGym: all present.' : `  READ-BACK PROBLEMS: ${res.problems.join('; ')}`)
  else if (!o.fromWeek) console.log('\nRe-run with --yes to write it.')
}

const isYes = answer => /^(y|yes|s|si|sí)$/i.test(String(answer).trim())
const TOKEN_WARN_DAYS = 75     // the server's session lasts 90 days unless SESSION_DAYS says otherwise

async function pairInteractively(io, preset = {}) {
  console.log('In openGym open Settings → "Pair the mobile app" and copy the code (it lasts 5 minutes).')
  const url = preset.url || await io.ask('Your openGym address (https://…): ')
  const code = await io.ask('Pairing code: ')
  await cmdPair({ url, code })
}

/**
 * The Sunday command. Everything that can be automated is: it reads the gym, plans the week, shows what it
 * would write and then asks. Nothing reaches openGym without a "y" from you.
 */
const DAY_WORDS = {
  mon: 'mon', monday: 'mon', lun: 'mon', lunes: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue', mar: 'tue', martes: 'tue',
  wed: 'wed', wednesday: 'wed', mie: 'wed', miercoles: 'wed', thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', jue: 'thu', jueves: 'thu',
  fri: 'fri', friday: 'fri', vie: 'fri', viernes: 'fri', sat: 'sat', saturday: 'sat', sab: 'sat', sabado: 'sat', sun: 'sun', sunday: 'sun', dom: 'sun', domingo: 'sun',
}
const CLASS_WORDS = { hyrox: 'hyrox', crossfit: 'crossfit', cf: 'crossfit' }
const SKIP_WORDS = new Set(['skip', 'no', 'not', 'without', 'sin', 'remove', 'cancel'])
const ADD_WORDS = new Set(['add', 'also', 'plus', 'con'])
const KEEP_WORDS = new Set(['ok', 'okay', 'keep', 'same', 'default', 'defaults', 'yes', 'y', 'si', 'vale'])
const FILLER = new Set(['and', 'y', 'the', 'this', 'week', 'on', 'for', 'i', 'will', 'am', 'going', 'to', 'a', 'class', 'clase'])

/**
 * What you type when asked which classes you attend this week: "skip tue", "tue=crossfit",
 * "skip tue and thu, add fri=crossfit". Enter alone keeps the defaults. Returns null when anything
 * is unclear, so a typo is asked about again instead of guessed.
 */
export function parseWeekAnswer(text) {
  const tokens = norm(text).replace(/[;,]/g, ' ').replace(/\s*=\s*/g, '=').split(/\s+/).filter(Boolean)
  const skip = [], add = {}
  let mode = null
  for (const tok of tokens) {
    if (SKIP_WORDS.has(tok)) { mode = 'skip'; continue }
    if (ADD_WORDS.has(tok)) { mode = 'add'; continue }
    if (KEEP_WORDS.has(tok) || FILLER.has(tok)) continue
    const pair = /^([a-z]+)=([a-z]+)$/.exec(tok)
    if (pair) {
      const day = DAY_WORDS[pair[1]], cls = CLASS_WORDS[pair[2]]
      if (!day || !cls) return null
      add[day] = cls
      continue
    }
    if (DAY_WORDS[tok] && mode === 'skip') { skip.push(DAY_WORDS[tok]); continue }
    return null
  }
  if (tokens.length && !skip.length && !Object.keys(add).length && !tokens.every(t => KEEP_WORDS.has(t))) return null   // only filler: unclear
  return { skip: [...new Set(skip)], add }
}

/** Shows the default classes and lets you change them for this week without remembering any flags. */
async function askClasses(o, io) {
  if (o.select || o.skip || o.add) return
  const { sel } = loadConfig()
  const show = selection => Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(' · ') || 'none'
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = await io.ask(`Classes this week: ${show(sel.defaults)} (your defaults).\nPress Enter to keep them, or type a change, e.g.  skip tue   ·   tue=crossfit   ·   skip tue, add fri=crossfit\n> `)
    const change = parseWeekAnswer(answer)
    if (!change) { console.log('   I did not understand that. Examples: "skip tue", "skip tue thu", "tue=crossfit".'); continue }
    if (change.skip.length) o.skip = change.skip.join(',')
    if (Object.keys(change.add).length) o.add = Object.entries(change.add).map(([d, c]) => `${d}=${c}`).join(',')
    console.log(`   This week: ${show(selectionFrom(o, sel).selection)}\n`)
    return
  }
  throw new Error('Could not read the class change. Run again and type for example: skip tue')
}

export async function cmdWeek(o, io = { ask }) {
  const say = (...a) => console.log(...a)
  say('SUNDAY FLOW: 1/3 read the gym · 2/3 plan the week · 3/3 openGym (asks before writing)\n')
  await askClasses(o, io)
  if (o['skip-fetch']) say('1/3 Using the publications already saved (--skip-fetch).')
  else { say('1/3 Reading the published classes from Aimharder (read-only)…'); await cmdFetch(o) }

  say('\n2/3 Planning the week…\n')
  cmdPlan(o)

  const proposal = readJson(outFile('proposal.json'))
  say('\n3/3 openGym')
  if (!proposal.classes.length) return say('   None of your selected classes is published yet, so there is nothing to write. Run this again in a while.')

  let tok = loadToken(tokenFile())
  if (!tok) {
    say('   Not paired with openGym yet (one time; it lasts about 90 days).')
    await pairInteractively(io)
    tok = loadToken(tokenFile())
  } else if (tok.savedAt && (Date.now() - Date.parse(tok.savedAt)) / 864e5 > TOKEN_WARN_DAYS) {
    say(`   Heads-up: your pairing is ${Math.floor((Date.now() - Date.parse(tok.savedAt)) / 864e5)} days old and lasts about 90. If a step says it was not accepted, run: node src/cli.mjs pair`)
  }

  let withFree = false
  if (proposal.free && !o['no-free'] && o.free !== 'none') {
    withFree = isYes(await io.ask(`   Also create the free workout "${proposal.free.routine.name}" on ${prettyDate(proposal.free.date)}? [y/N] `))
  }

  const preview = () => cmdApply({ ...o, yes: false, 'with-free': withFree, fromWeek: true })
  try { await preview() } catch (e) {
    if (!(e instanceof OpenGymError && e.code === 'UNAUTHORIZED')) throw e
    say('   openGym did not accept the saved pairing (it expired). Pairing again:')
    await pairInteractively(io, { url: tok?.baseUrl })
    await preview()
  }
  if (proposal.notFound.length) say(`   Not published yet: ${proposal.notFound.map(n => `${n.day} ${n.cls}`).join(', ')}. Run "npm run week" again later; routines already written are refreshed, never duplicated.`)

  const checks = proposal.classes.flatMap(c => (c.warnings ?? []).map(w => `${DAY_LONG[c.day]} ${c.cls}: ${w}`))
  if (checks.length) {
    say(`\n   ${checks.length} value(s) in the gym's data looked wrong. I replaced them with safe defaults (marked in each exercise's note):`)
    for (const w of checks) say(`     - ${w}`)
    say('   Say N below if you would rather look at out/plan.txt first.')
  }
  if (!isYes(await io.ask('\nWrite this to openGym now? [y/N] '))) {
    return say('Nothing was written. Happy with it later? "npm run week -- --skip-fetch" shows it again, or "node src/cli.mjs apply --yes".')
  }
  await cmdApply({ ...o, yes: true, 'with-free': withFree, fromWeek: true })
  say('\nDone. Open openGym → Plan to see the week.')
}

async function main() {
  const { values: o, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true })
  const cmd = positionals[0]
  if (!cmd || o.help) return console.log(HELP)
  const fn = { week: cmdWeek, fetch: cmdFetch, plan: cmdPlan, clean: cmdClean, pair: cmdPair, apply: cmdApply }[cmd]
  if (!fn) return console.log(`Unknown command "${cmd}".\n${HELP}`)
  await fn(o)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    const known = e instanceof AimharderError || e instanceof OpenGymError
    console.error(`\n${known ? e.message : 'Error: ' + e.message}`)
    if (!known && process.env.DEBUG) console.error(e.stack)
    process.exit(1)
  })
}
