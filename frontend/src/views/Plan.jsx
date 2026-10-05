import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useState } from 'react'
import { weekStartOf, startOfWeek, isoOf, todayISO, uid, exCount, routineCount } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { planToolsSheet, calendarSheet, categoriesSheet, routineDetailSheet, workoutDetailSheet } from '../sheets.jsx'
import CatDot from '../components/CatDot.jsx'
import { effectiveRoutines } from '../lib/history.js'
import { addToDate, removeFromDate, categoryOf, catColor } from '../lib/plan.js'
import Icon from '../components/Icon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)

  /* The Coach's only entry point in the app. Its screens have existed since the UI landed and
     nothing linked to them, so the feature was reachable only by typing the URL — enabled,
     configured, and invisible. The same predicate every other Coach surface uses gates it, so
     an instance without the feature sees exactly the Plan screen it saw before. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // ＋ on a date: a new activity for that date only, opened in the editor. Activities are not
  // kept as a reusable library — one that leaves its last date is deleted (lib/plan.js).
  const newActivity = iso => {
    const r = { id: uid(), name: t('New activity'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r); addToDate(s, iso, r.id) })
    nav('/plan/r/' + r.id)
  }

  // The dated week: real dates, each with its own activity list (lib/plan.js). Starts on the
  // current week and follows the week-start setting, like Home's strip.
  const [weekOffset, setWeekOffset] = useState(0)
  const ws = weekStartOf(S)
  const today = todayISO()
  const wkStart = startOfWeek(today, ws)
  wkStart.setDate(wkStart.getDate() + weekOffset * 7)
  const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(wkStart); d.setDate(wkStart.getDate() + i); return d })
  const wkEnd = dates[6]
  const short = d => d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
  const wkLabel = weekOffset === 0 ? t('This week') : `${short(wkStart)} – ${short(wkEnd)}`
  const doneOn = iso => S.workouts.filter(w => w.d === iso)
  const cats = S.categories || []

  // One activity sub-row: the category colour runs down its left edge; tapping it shows what
  // the routine trains (routineDetailSheet), ✕ takes it off this day only.
  const activity = (r, onRemove, iso) => {
    const cat = categoryOf(S, r)
    return <div key={r.id} className="row plan-act" style={{ gap: 8, padding: '4px 0 4px 8px', '--cat': cat ? catColor(cat) : 'transparent' }}
      {...tappable(() => routineDetailSheet(r.id, iso))}>
      <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{r.name}</div>
        <div className="ss">{cat && <>{cat.name} · </>}{r.ex.length || !r.note ? exCount(r.ex.length) : r.note.split('\n')[0]}</div></div>
      <button className="iconbtn sm" aria-label={t('Remove')} onClick={ev => { ev.stopPropagation(); onRemove() }}><Icon name="xmark" /></button>
    </div>
  }
  // The day's header row: name on the left, status and the ＋ that adds an activity on the right.
  const dayHead = (title, status, onAdd, spaced) => <div className="row between" style={{ marginBottom: spaced ? 6 : 0, gap: 8 }}>
    <div className="tt">{title}</div>
    <div className="row" style={{ gap: 6, minWidth: 0 }}>
      {status}
      <button className="iconbtn sm" aria-label={t('Add activity')} title={t('Add activity')} onClick={onAdd}><Icon name="plus" /></button>
    </div>
  </div>

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={() => calendarSheet(isoOf(wkStart))} aria-label={t('Month')} title={t('Month')}><Icon name="calendar" /></button>
        <button className="iconbtn" onClick={() => categoriesSheet()} aria-label={t('Categories')} title={t('Categories')}><Icon name="folder" /></button>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
      </div>
    </div>
    {showCoach && <button className="coach-cta" onClick={() => nav('/coach')}>
      <span className="coach-cta-av"><Icon name="sparkles" /></span>
      <span className="coach-cta-t">
        <b>{t('Coach')}</b>
        <span>{t('Plan design and reviews, from your own training')}</span>
      </span>
      <Icon name="chevronRight" className="coach-cta-chev" />
    </button>}

    <div className="row between plan-weeknav">
      <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
      <button className="plan-wklabel" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0} aria-label={t('This week')}>{wkLabel}</button>
      <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
    </div>
    <div className="list plan-dates" style={{ display: 'flex', flexDirection: 'column' }}>
      {dates.map(d => {
        const iso = isoOf(d)
        const acts = effectiveRoutines(S, iso)
        const done = doneOn(iso)
        const status = done.length > 0
          ? <button className="tag acc plan-done" onClick={() => workoutDetailSheet(done[done.length - 1])}><Icon name="check" /> {done.map(w => w.name).join(' + ')}</button>
          : acts.length ? <div className="small dim">{routineCount(acts.length)}</div> : <span className="tag">{t('Rest')}</span>
        return <div key={iso} className={'item' + (iso === today ? ' plan-today' : '')} style={{ display: 'block', padding: '10px 14px' }}>
          {dayHead(d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric' }), status, () => newActivity(iso), acts.length > 0)}
          {acts.map(r => activity(r, () => update(s => removeFromDate(s, iso, r.id)), iso))}
        </div>
      })}
    </div>
    {cats.length > 0 && <div className="plan-legend">
      {cats.map(c => <span key={c.id}><CatDot cat={c} />{c.name}</span>)}
    </div>}
  </>
}
