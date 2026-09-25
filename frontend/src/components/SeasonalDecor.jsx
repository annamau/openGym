import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from './Icon.jsx'

export default function SeasonalDecor() {
  const loc = useLocation()
  const theme = useStore(s => s.S?.theme)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  // Seasonal decor is only displayed in Settings, keeping all working sides of the app (workout, routine, logger) completely clean
  if (loc.pathname !== '/settings') return null

  const resolved = theme === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : (theme || 'pink')

  if (resolved === 'christmas') {
    const items = [
      { id: 1, left: '8%', dur: '12s', delay: '0s', size: 14, isIcon: true, op: 0.55 },
      { id: 2, left: '18%', dur: '9s', delay: '2.5s', size: 6, isIcon: false, op: 0.65 },
      { id: 3, left: '28%', dur: '14s', delay: '1s', size: 17, isIcon: true, op: 0.45 },
      { id: 4, left: '38%', dur: '8.5s', delay: '4s', size: 5, isIcon: false, op: 0.7 },
      { id: 5, left: '48%', dur: '11s', delay: '1.5s', size: 7, isIcon: false, op: 0.6 },
      { id: 6, left: '58%', dur: '13s', delay: '3.5s', size: 16, isIcon: true, op: 0.5 },
      { id: 7, left: '68%', dur: '10s', delay: '0.5s', size: 6, isIcon: false, op: 0.65 },
      { id: 8, left: '78%', dur: '15s', delay: '5s', size: 19, isIcon: true, op: 0.4 },
      { id: 9, left: '88%', dur: '8.8s', delay: '2s', size: 5, isIcon: false, op: 0.75 },
      { id: 10, left: '94%', dur: '12.5s', delay: '4.5s', size: 15, isIcon: true, op: 0.5 },
    ]

    return (
      <div className="seasonal-overlay christmas-overlay" aria-hidden="true">
        {/* Falling gentle snowflakes & ice crystals centered over Settings card */}
        {items.map(f => (
          <div
            key={f.id}
            className={f.isIcon ? 'snow-icon' : 'snow-flake'}
            style={{
              left: f.left,
              animationDuration: f.dur,
              animationDelay: f.delay,
              width: f.size,
              height: f.size,
              opacity: f.op,
            }}
          >
            {f.isIcon && <Icon name="snowflake" size={f.size} />}
          </div>
        ))}
      </div>
    )
  }

  return null
}
