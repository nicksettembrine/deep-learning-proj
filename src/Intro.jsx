import { useEffect, useRef, useState } from 'react'
import { WALK_PATH } from './walkPath'

// Opening animation: a real 4-second walking signal (walkPath.js) draws itself like a pen
// stroke, the app name fades in, and the page appears. onDone tells the app it has finished.

const SEEN_KEY = 'intro-seen'

function shouldPlay() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    return !sessionStorage.getItem(SEEN_KEY)          // once per browser session
  } catch {
    return false
  }
}

export default function Intro({ onDone }) {
  const [phase, setPhase] = useState(() => (shouldPlay() ? 'drawing' : 'done'))
  const pathRef = useRef(null)

  // Runs once when the intro mounts. The timers are not tied to `phase`, so moving to
  // 'leaving' does not cancel the timer that finishes the intro.
  useEffect(() => {
    if (phase !== 'drawing') return
    try { sessionStorage.setItem(SEEN_KEY, '1') } catch { /* private window: play again next time */ }
    // Set the dash length to the path's real length so the stroke draws from start to end.
    const length = pathRef.current?.getTotalLength() ?? 3200
    pathRef.current?.style.setProperty('--length', length)
    const leave = setTimeout(() => setPhase((current) => (current === 'drawing' ? 'leaving' : current)), 2600)
    const finish = setTimeout(() => setPhase('done'), 3200)
    return () => { clearTimeout(leave); clearTimeout(finish) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (phase === 'done') onDone() }, [phase, onDone])

  if (phase === 'done') return null
  const skip = () => setPhase('done')
  return (
    <div className={`intro${phase === 'leaving' ? ' intro-leaving' : ''}`} onClick={skip}
      onKeyDown={skip} role="presentation">
      <svg viewBox="0 0 1000 240" className="intro-trace" aria-hidden="true">
        <path ref={pathRef} d={WALK_PATH} />
      </svg>
      <p className="intro-title">Accelerometry Activity Viewer</p>
      <p className="intro-caption">Left wrist, walking, 4 seconds</p>
    </div>
  )
}
