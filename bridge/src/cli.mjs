#!/usr/bin/env node
// openGym bridge: Aimharder class workouts -> analysis -> openGym routines.
//
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
import { DAYS, DAY_LONG, addDays, mondayOf, todayIso, weekdayOf, prettyDate } from './util.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.resolve(ROOT, ...a)   // an absolute path (e.g. --out) is used as given
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
  url: { type: 'string' }, code: { type: 'string' }, 'max-posts': { type: 'string' }, help: { type: 'boolean', short: 'h' },
}

const HELP = `
openGym bridge

  fetch   [--domain aimharder.es] [--gym ID] [--select ...]   (keeps only your selected classes; the rest is not saved)
  clean   [--select ...]                         (deletes from out/week-raw.json everything that is not a selected class)
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

async function cmdFetch(o) {
  const username = process.env.AIMHARDER_USER || await ask('Aimharder email or username: ')
  const password = process.env.AIMHARDER_PASSWORD || await ask('Aimharder password (hidden): ', { hidden: true })
  const client = new AimharderClient({ username, password, domain: o.domain || process.env.AIMHARDER_DOMAIN || 'aimharder.es' })
  const result = await client.fetchPublished({
    gymId: o.gym, maxPosts: Number(o['max-posts'] || 40),
    onProgress: ({ i, of }) => process.stderr.write(`\r  reading publication ${i}/${of}   `),
  })
  process.stderr.write('\n')
  const { sel } = loadConfig()
  const { selection } = selectionFrom(o, sel)
  const file = P(o.out || 'out/week-raw.json')
  // Only the classes you attend are kept; the rest of the feed is never written to disk.
  const { kept, dropped } = pruneItems(result.items, selection, sel.rules || DEFAULT_RULES)
  writeJson(file, scrub({ fetchedAt: new Date().toISOString(), gym: result.gym, selection, items: kept }))
  const { workouts, unreadable } = readWorkouts(file)
  console.log(`Gym: ${result.gym.name}. ${result.items.length} workout publications read (feed had ${result.feedSize}).`)
  console.log(`Kept ${kept.length}: only your selected classes (${Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(', ')}). The other ${dropped} were not saved.`)
  for (const w of workouts.sort((a, b) => a.date.localeCompare(b.date))) console.log(`  ${w.date} ${DAY_LONG[DAYS[(weekdayOf(w.date) + 6) % 7]]}  ${classify(w, sel.rules || DEFAULT_RULES)} [${w.sourceId}] ${w.exercises.length} exercises`)
  if (unreadable.length) console.log(`  could not read ${unreadable.length}: ${[...new Set(unreadable)].join('; ')}`)
  console.log(`\nSaved ${path.relative(process.cwd(), file)} (email/phone/token-like fields removed). If you change the selection later, run fetch again.`)
}

function cmdClean(o) {
  const { sel } = loadConfig()
  const { selection } = selectionFrom(o, sel)
  const file = P(o.out || 'out/week-raw.json')
  if (!fs.existsSync(file)) return console.log('No week-raw.json to clean.')
  const raw = readJson(file)
  const { kept, dropped } = pruneItems(raw.items, selection, sel.rules || DEFAULT_RULES)
  writeJson(file, scrub({ fetchedAt: raw.fetchedAt, gym: raw.gym, selection, items: kept }))
  console.log(`Kept ${kept.length} publication(s) for ${Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(', ')}; deleted ${dropped} that were not selected.`)
}

function cmdPlan(o) {
  const { sel, targets } = loadConfig()
  const rawFile = o.demo ? P('test', 'fixtures', 'week-demo.json') : P(o.out || 'out/week-raw.json')
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
  const freeRec = recommendFree({ menu, sessions: base.sessions, targets, selection: sel, dates: datesList, lastFree: o['last-free'] })
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
    classes: built.map(b => ({ date: b.date, day: b.day, cls: b.cls, routine: b.routine, customEx: b.customEx, unresolved: b.unresolved })),
    free: choice ? { key: choice.key, date: freeDate, routine: menu[choice.key].routine, customEx: menu[choice.key].customEx, options: freeRec.options.map(({ key, score, gain, penalty, rotation }) => ({ key, score, gain, penalty, rotation })) } : null,
    notFound: resolved.filter(r => r.status !== 'ok').map(r => ({ day: r.day, date: r.date, cls: r.cls, status: r.status })),
  }
  if (!o.demo) {
    writeJson(P('out', 'proposal.json'), proposal)
    fs.writeFileSync(P('out', 'plan.txt'), text + '\n')
    console.log('\nSaved out/plan.txt (this report, to read in VS Code) and out/proposal.json (what apply would write). Nothing has been sent to openGym.')
  }
  else console.log('\n(demo: sample data, nothing saved)')
}

async function cmdPair(o) {
  const url = o.url || await ask('Your openGym address (https://…): ')
  const code = o.code || await ask('Pairing code from Settings → Pair the mobile app: ')
  const info = await redeemPairingCode(url, code)
  saveToken(P('.opengym-token.json'), info)
  console.log(`Paired${info.user ? ' as ' + info.user : ''}. Token saved to .opengym-token.json (kept out of git, valid for the server's session length).`)
}

async function cmdApply(o) {
  const file = P('out', 'proposal.json')
  if (!fs.existsSync(file)) throw new Error('No out/proposal.json. Run "plan" first.')
  const proposal = readJson(file)
  const tok = loadToken(P('.opengym-token.json'))
  if (!tok) throw new Error('Not paired yet. Run "pair" first.')
  const withFree = !!o['with-free'] && proposal.free
  const plan = {
    routines: proposal.classes.map(c => c.routine),
    free: withFree ? [proposal.free.routine] : [],
    customEx: [...proposal.classes.flatMap(c => c.customEx), ...(withFree ? proposal.free.customEx : [])],
    schedule: { ...Object.fromEntries(proposal.classes.map(c => [c.date, c.routine.id])), ...(withFree ? { [proposal.free.date]: proposal.free.routine.id } : {}) },
  }
  const client = new OpenGymClient({ baseUrl: tok.baseUrl, token: tok.token })
  const res = await syncToOpenGym({ client, plan, backupDir: P('backups'), dryRun: !o.yes, force: !!o.force })
  const r = res.report
  console.log(res.dryRun ? 'DRY RUN — nothing written.' : `WRITTEN (revision ${res.rev}). Backup: ${path.relative(process.cwd(), res.backup)}`)
  console.log(`  new routines:        ${r.added.join(', ') || '—'}`)
  console.log(`  refreshed routines:  ${r.refreshed.join(', ') || '—'}`)
  console.log(`  kept as they were:   ${r.kept.join(', ') || '—'}`)
  console.log(`  new custom exercises: ${r.customAdded.join(', ') || '—'}`)
  console.log(`  scheduled:           ${r.scheduled.map(s => `${s.iso} → ${s.id}`).join(', ') || '—'}`)
  for (const s of r.skippedDays) console.log(`  NOT scheduled ${s.iso}: that day already has "${s.existing}" in your plan`)
  if (proposal.free && !withFree) console.log(`  (free workout "${proposal.free.routine.name}" not included; add --with-free once you approve it)`)
  if (proposal.notFound.length) console.log(`  days with no workout yet: ${proposal.notFound.map(n => `${n.day} ${n.cls} [${n.status}]`).join(', ')}`)
  if (!res.dryRun) console.log(res.verified ? '  read back from openGym: all present.' : `  READ-BACK PROBLEMS: ${res.problems.join('; ')}`)
  else console.log('\nRe-run with --yes to write it.')
}

async function main() {
  const { values: o, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true })
  const cmd = positionals[0]
  if (!cmd || o.help) return console.log(HELP)
  const fn = { fetch: cmdFetch, plan: cmdPlan, clean: cmdClean, pair: cmdPair, apply: cmdApply }[cmd]
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
