#!/usr/bin/env node
// Writes the Phase 1 runs and the two races from ui/plan.json into config/extras.local.json.
// Safe to re-run: entries have stable "plan-*" ids and are replaced, never duplicated.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'ui', 'plan.json'), 'utf8'))
const file = process.env.BRIDGE_EXTRAS_FILE ? path.resolve(process.env.BRIDGE_EXTRAS_FILE) : path.join(ROOT, 'config', 'extras.local.json')
const OFFSET = { mon: 0, fri: 4, sun: 6 }, TIME = { mon: '18:00', fri: '18:00', sun: '09:00' }
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const out = []
for (const wk of plan.weeks) for (const [day, title, detail] of wk.runs) {
  out.push({ id: `plan-w${wk.w}-${day}`, title, type: 'run', date: addDays(wk.start, OFFSET[day]), time: TIME[day], detail, tags: ['Phase 1', `W${wk.w}`] })
}
for (const r of plan.races) out.push({ id: `plan-race-${r.date}`, title: `RACE: ${r.name}`, type: 'run', date: r.date, time: '09:00', detail: 'Race day.', tags: ['Race'] })

const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
const merged = [...cur.filter(s => !String(s.id).startsWith('plan-')), ...out]
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(merged, null, 2))
console.log(`seeded ${out.length} plan sessions into ${file}`)
