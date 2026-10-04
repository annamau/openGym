import { DAY_LONG, prettyDate } from './util.mjs'
import { labelOf } from './analyze.mjs'

const top = (load, n = 6) => Object.entries(load).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(' · ')
const clock = t => { const h = ((t % 24) + 24) % 24, hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }
const when = s => `${DAY_LONG[s.day]} ${clock(s.t)}`
const tag = s => s.kind === 'class' ? (s.cls === 'hyrox' ? 'Hyrox' : 'CrossFit') : s.kind === 'free' ? 'free workout' : s.name

export function renderPlan({ weekOf, selection, selectionNote, resolved, built, analysis, freeRec, freeChoice, menu, targets, unreadable }) {
  const L = []
  L.push(`WEEK OF ${DAY_LONG.mon} ${prettyDate(weekOf)}`)
  L.push(`Classes: ${Object.entries(selection).map(([d, c]) => `${DAY_LONG[d]} ${c}`).join(' · ') || 'none'}  (${selectionNote})`)
  if (unreadable.length) L.push(`Publications I could not read: ${unreadable.length} (${[...new Set(unreadable)].join('; ')})`)
  L.push('')

  for (const r of resolved) {
    const head = `${DAY_LONG[r.day].toUpperCase()} ${prettyDate(r.date)} — ${r.cls === 'hyrox' ? 'Hyrox' : 'CrossFit'}`
    if (r.status === 'missing') {
      L.push(`${head}: NOT FOUND for that date${r.unclear?.length ? ` (${r.unclear.length} publication(s) that day are neither "Hyrox…" nor untitled; titles: ${r.unclear.flatMap(u => u.titles).join(' | ') || 'n/a'})` : ' (not published yet?)'}`, '')
      continue
    }
    if (r.status === 'ambiguous') {
      L.push(`${head}: AMBIGUOUS — ${r.candidates.length} publications match. I did not pick. Re-run with --pick ${r.day}=<id> using one of: ${r.candidates.map(c => `${c.sourceId} (${c.titles.join(' / ') || 'untitled'})`).join(', ')}`, '')
      continue
    }
    const b = built.find(x => x.date === r.date)
    const s = analysis.sessions.find(x => x.kind === 'class' && x.date === r.date)
    L.push(`${head}: ${s.summary}   [effort ~${s.rough}, rough estimate]`)
    L.push(`   Muscles (effective sets, the app's way of counting): ${top(s.load) || 'none recognised'}${s.cardio >= 1 ? ` · cardio ${s.cardio}` : ''}`)
    L.push(`   Recognised ${b.movements.length} movement(s); strength sets ${b.effort.strengthSets}, conditioning ~${b.effort.condMinutes} min`)
    if (b.unresolved.length) L.push(`   NOT recognised (not counted): ${b.unresolved.join(' | ')}`)
    const approx = b.movements.filter(m => m.setsSource === 'amrap-estimate' || m.setsSource === 'default')
    if (approx.length) L.push(`   Set counts estimated for: ${[...new Set(approx.map(m => m.movement))].join(', ')}`)
    L.push('')
  }

  L.push('OVERLAPS (a muscle still carrying the earlier session into the later one)')
  const shown = analysis.overlaps.filter(o => o.to.t >= 0 && o.to.t < 168)
  if (!shown.length) L.push('   none above the threshold')
  for (const o of shown) {
    L.push(`   ${when(o.from)} ${tag(o.from)} → ${when(o.to)} ${tag(o.to)} (${o.hours} h): ` +
      o.muscles.slice(0, 5).map(m => `${m.slug} ${m.carried} carried [${m.severity}]`).join(' · '))
  }
  L.push('')

  L.push(`OBJECTIVES — classes only, growth-stimulus sets this week (conditioning counts ${targets.stimulusFactors.conditioning * 100}%, cardio ${targets.stimulusFactors.cardio * 100}% of a strength set)`)
  for (const g of analysis.gapsClassesOnly) L.push(`   ${g.label.padEnd(8)} ${String(g.have).padStart(5)} / ${g.target}   ${g.gap > 0 ? `short by ${g.gap}` : 'covered'}`)
  L.push('')

  L.push(`FREE WORKOUT (${DAY_LONG[freeRec.freeDay]}) — one per week`)
  for (const o of freeRec.options) {
    L.push(`   ${o.name}: score ${o.score} = coverage ${o.gain} − clashes ${o.penalty}${o.rotation ? ` + rotation ${o.rotation}` : ''}`)
    const cov = o.coverage.filter(c => c.counted > 0).map(c => `${c.label} +${c.counted} of ${c.gap}`)
    if (cov.length) L.push(`      fills: ${cov.join(' · ')}`)
    const cl = o.clashes.slice(0, 4).map(c => `${c.slug} vs ${c.with} (${c.hours} h ${c.direction === 'later' ? 'before' : 'after'}) ${c.overlap}`)
    if (cl.length) L.push(`      clashes: ${cl.join(' · ')}`)
  }
  if (freeChoice) {
    L.push(`   → ${freeChoice.forced ? 'You asked for' : 'Recommended:'} ${menu[freeChoice.key].routine.name}`)
    const m = menu[freeChoice.key]
    if (m.usingExample) L.push(`      NOTE: config/free/${m.wantedFile} was not found, so this is the generic example routine with placeholder weights. Put your own Hevy share text in that file.`)
    L.push(`      same exercises as before; start weights from your last logged sets (edit in the app):`)
    for (const w of m.startWeights) L.push(`        ${w}`)
    if (m.unresolved.length) L.push(`      not in the library, left out: ${m.unresolved.join(', ')}`)
    for (const a of freeRec.addOns) L.push(`      optional (not applied): +${a.extraSets} set(s) of ${a.title} would cover ${a.label}, still short by ${a.stillShort}`)
  } else L.push('   → no free workout chosen')
  L.push('')
  L.push('Final week, with the free workout (same counting):')
  for (const g of analysis.gapsWithAll) L.push(`   ${g.label.padEnd(8)} ${String(g.have).padStart(5)} / ${g.target}   ${g.gap > 0 ? `short by ${g.gap}` : 'covered'}`)
  return L.join('\n')
}

export { labelOf }
