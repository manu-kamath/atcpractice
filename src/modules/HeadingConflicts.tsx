import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 5)!
const QUESTIONS = 8
const TIME_MS = 15000
const DEG = Math.PI / 180
const RADAR_NM = 80           // ±80 nm visible
const CANVAS = 360
const PX = CANVAS / (RADAR_NM * 2)   // pixels per nm
const SEP_NM = 5              // conflict threshold
const HORIZON = 15            // look-ahead minutes
const VECTOR_MIN = 8          // minutes of heading vector shown

const CALLSIGNS = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO']

interface Aircraft {
  id: string
  x: number    // nm east of centre
  y: number    // nm north of centre
  hdg: number  // degrees, 0=N
  spd: number  // nm/min
  alt: number  // flight level × 100 ft
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function posAt(ac: Aircraft, t: number): [number, number] {
  return [
    ac.x + ac.spd * Math.sin(ac.hdg * DEG) * t,
    ac.y + ac.spd * Math.cos(ac.hdg * DEG) * t,   // +y = north
  ]
}

function minSep(a: Aircraft, b: Aircraft): number {
  let min = Infinity
  for (let t = 0; t <= HORIZON; t += 0.25) {
    const [ax, ay] = posAt(a, t)
    const [bx, by] = posAt(b, t)
    min = Math.min(min, Math.hypot(ax - bx, ay - by))
  }
  return min
}

function randFloat(lo: number, hi: number) { return lo + Math.random() * (hi - lo) }
function randInt(lo: number, hi: number) { return Math.floor(randFloat(lo, hi + 1)) }

// ─── Question generation ──────────────────────────────────────────────────────

interface Pair { a: number; b: number }

interface Question {
  aircraft: Aircraft[]
  conflictPair: Pair
  options: Pair[]       // 4 options
  correctIndex: number
}

function pairEq(p: Pair, q: Pair) { return p.a === q.a && p.b === q.b }

function makePairs(n: number): Pair[] {
  const out: Pair[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push({ a: i, b: j })
  return out
}

function toCanvas(nx: number, ny: number): [number, number] {
  return [CANVAS / 2 + nx * PX, CANVAS / 2 - ny * PX]
}

function generateQuestion(qIdx: number): Question {
  const nAc = qIdx < 4 ? 4 : 5

  for (let attempt = 0; attempt < 60; attempt++) {
    // 1. Create a conflicting pair heading toward a common point
    const cx = randFloat(-20, 20)
    const cy = randFloat(-20, 20)
    const tConflict = randFloat(5, 10)

    const hdgA = randInt(0, 359)
    const delta = randInt(40, 140) * (Math.random() < 0.5 ? 1 : -1)
    const hdgB = ((hdgA + delta) + 360) % 360

    const spdA = randFloat(6.0, 8.0)
    const spdB = randFloat(6.0, 8.0)

    // Back-project from conflict point: aircraft arrive at (cx,cy) at t=tConflict
    const rawA: Aircraft = {
      id: '', x: cx - spdA * Math.sin(hdgA * DEG) * tConflict,
      y: cy - spdA * Math.cos(hdgA * DEG) * tConflict,
      hdg: hdgA, spd: spdA, alt: randInt(25, 45) * 10,
    }
    const rawB: Aircraft = {
      id: '', x: cx - spdB * Math.sin(hdgB * DEG) * tConflict,
      y: cy - spdB * Math.cos(hdgB * DEG) * tConflict,
      hdg: hdgB, spd: spdB, alt: randInt(25, 45) * 10,
    }

    // Validate: within radar, far apart initially, confirmed conflict
    if (Math.hypot(rawA.x, rawA.y) > RADAR_NM * 0.85) continue
    if (Math.hypot(rawB.x, rawB.y) > RADAR_NM * 0.85) continue
    if (Math.hypot(rawA.x - rawB.x, rawA.y - rawB.y) < 25) continue
    if (minSep(rawA, rawB) > SEP_NM) continue

    // 2. Generate non-conflicting aircraft
    const others: Aircraft[] = []
    let ok = true
    for (let i = 2; i < nAc; i++) {
      let placed = false
      for (let ot = 0; ot < 80; ot++) {
        const ac: Aircraft = {
          id: '', x: randFloat(-RADAR_NM * 0.75, RADAR_NM * 0.75),
          y: randFloat(-RADAR_NM * 0.75, RADAR_NM * 0.75),
          hdg: randInt(0, 359), spd: randFloat(6, 8), alt: randInt(25, 45) * 10,
        }
        const all = [rawA, rawB, ...others]
        // Must not conflict with any existing aircraft
        if (all.every((o) => minSep(ac, o) > SEP_NM * 2.5)) {
          // Also ensure no two non-conflicting aircraft are too close visually
          const [cx2, cy2] = toCanvas(ac.x, ac.y)
          const tooClose = all.some((o) => {
            const [ox, oy] = toCanvas(o.x, o.y)
            return Math.hypot(cx2 - ox, cy2 - oy) < 35
          })
          if (!tooClose) { others.push(ac); placed = true; break }
        }
      }
      if (!placed) { ok = false; break }
    }
    if (!ok) continue

    // 3. Shuffle aircraft order so conflict pair isn't always first
    const rawAll = [rawA, rawB, ...others]
    const perm = Array.from({ length: nAc }, (_, i) => i)
    for (let i = perm.length - 1; i > 0; i--) {
      const j = randInt(0, i)
      ;[perm[i], perm[j]] = [perm[j], perm[i]]
    }
    const aircraft: Aircraft[] = perm.map((origIdx, newIdx) => ({
      ...rawAll[origIdx], id: CALLSIGNS[newIdx],
    }))
    const newIdxA = perm.indexOf(0)
    const newIdxB = perm.indexOf(1)
    const conflictPair: Pair = newIdxA < newIdxB
      ? { a: newIdxA, b: newIdxB }
      : { a: newIdxB, b: newIdxA }

    // 4. Build 4 options
    const allPairs = makePairs(nAc)
    const nonConflict = allPairs.filter((p) => !pairEq(p, conflictPair))
    const wrong = nonConflict.sort(() => Math.random() - 0.5).slice(0, 3)
    const options = [conflictPair, ...wrong].sort(() => Math.random() - 0.5)
    const correctIndex = options.findIndex((p) => pairEq(p, conflictPair))

    return { aircraft, conflictPair, options, correctIndex }
  }

  // Deterministic fallback — two aircraft clearly head-on
  const ac0: Aircraft = { id: 'ALFA', x: -50, y: 0, hdg: 90, spd: 7, alt: 350 }
  const ac1: Aircraft = { id: 'BRAVO', x: 50, y: 0, hdg: 270, spd: 7, alt: 350 }
  const ac2: Aircraft = { id: 'CHARLIE', x: 0, y: 60, hdg: 200, spd: 7, alt: 280 }
  const ac3: Aircraft = { id: 'DELTA', x: -30, y: -50, hdg: 20, spd: 7, alt: 310 }
  const aircraft = [ac0, ac1, ac2, ac3]
  const conflictPair: Pair = { a: 0, b: 1 }
  const options: Pair[] = [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 3 }]
    .sort(() => Math.random() - 0.5)
  const correctIndex = options.findIndex((p) => pairEq(p, conflictPair))
  return { aircraft, conflictPair, options, correctIndex }
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawRadar(
  canvas: HTMLCanvasElement,
  aircraft: Aircraft[],
  highlightPair: Pair | null,
  feedbackCorrect: boolean | null,
  showProjection: boolean
) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, CANVAS, CANVAS)

  // Background
  ctx.fillStyle = '#060e1c'
  ctx.beginPath()
  ctx.arc(CANVAS / 2, CANVAS / 2, CANVAS / 2, 0, Math.PI * 2)
  ctx.fill()

  // Range rings
  for (const r of [20, 40, 60, 80]) {
    ctx.strokeStyle = `rgba(0,212,255,${r === 80 ? 0.12 : 0.06})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(CANVAS / 2, CANVAS / 2, r * PX, 0, Math.PI * 2)
    ctx.stroke()
    if (r < 80) {
      ctx.fillStyle = 'rgba(0,212,255,0.2)'
      ctx.font = '9px "Share Tech Mono"'
      ctx.textAlign = 'left'
      ctx.fillText(`${r}nm`, CANVAS / 2 + r * PX + 3, CANVAS / 2 - 2)
    }
  }

  // Crosshairs
  ctx.strokeStyle = 'rgba(0,212,255,0.05)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(CANVAS / 2, 0); ctx.lineTo(CANVAS / 2, CANVAS)
  ctx.moveTo(0, CANVAS / 2); ctx.lineTo(CANVAS, CANVAS / 2)
  ctx.stroke()

  // Clip to circle
  ctx.save()
  ctx.beginPath()
  ctx.arc(CANVAS / 2, CANVAS / 2, CANVAS / 2, 0, Math.PI * 2)
  ctx.clip()

  // Draw each aircraft
  aircraft.forEach((ac, idx) => {
    const [sx, sy] = toCanvas(ac.x, ac.y)

    const isHighlighted = highlightPair !== null &&
      (highlightPair.a === idx || highlightPair.b === idx)

    let color: string
    if (feedbackCorrect === null) {
      color = '#00d4ff'
    } else if (isHighlighted) {
      color = feedbackCorrect ? '#00ff9f' : '#ff3b5c'
    } else {
      color = 'rgba(0,212,255,0.35)'
    }

    // Projected path (shown post-feedback on conflict pair)
    if (showProjection && isHighlighted) {
      const [ex, ey] = toCanvas(
        ac.x + ac.spd * Math.sin(ac.hdg * DEG) * HORIZON,
        ac.y + ac.spd * Math.cos(ac.hdg * DEG) * HORIZON,
      )
      ctx.strokeStyle = `${color}55`
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      ctx.setLineDash([])
    }

    // Heading vector (VECTOR_MIN minutes)
    const [vx, vy] = toCanvas(
      ac.x + ac.spd * Math.sin(ac.hdg * DEG) * VECTOR_MIN,
      ac.y + ac.spd * Math.cos(ac.hdg * DEG) * VECTOR_MIN,
    )
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(vx, vy); ctx.stroke()
    ctx.setLineDash([])

    // Arrow head
    const angle = Math.atan2(vy - sy, vx - sx)
    const aSize = 6
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(vx, vy)
    ctx.lineTo(vx - aSize * Math.cos(angle - 0.4), vy - aSize * Math.sin(angle - 0.4))
    ctx.lineTo(vx - aSize * Math.cos(angle + 0.4), vy - aSize * Math.sin(angle + 0.4))
    ctx.closePath(); ctx.fill()

    // Dot
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = isHighlighted ? 16 : 8
    ctx.beginPath(); ctx.arc(sx, sy, isHighlighted ? 5 : 4, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0

    // Label block: callsign + alt
    const labelX = sx + 9
    const labelY = sy - 12
    ctx.font = 'bold 10px "Share Tech Mono"'
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.fillText(ac.id, labelX, labelY)
    ctx.font = '9px "Share Tech Mono"'
    ctx.fillStyle = `${color}bb`
    ctx.fillText(`FL${ac.alt}`, labelX, labelY + 11)
  })

  ctx.restore()

  // Outer ring border
  ctx.strokeStyle = 'rgba(0,212,255,0.2)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(CANVAS / 2, CANVAS / 2, CANVAS / 2 - 1, 0, Math.PI * 2)
  ctx.stroke()
}

// ─── Radar canvas component ───────────────────────────────────────────────────

interface RadarProps {
  aircraft: Aircraft[]
  highlightPair: Pair | null
  feedbackCorrect: boolean | null
  showProjection: boolean
}

function RadarCanvas({ aircraft, highlightPair, feedbackCorrect, showProjection }: RadarProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current) drawRadar(ref.current, aircraft, highlightPair, feedbackCorrect, showProjection)
  }, [aircraft, highlightPair, feedbackCorrect, showProjection])

  return (
    <canvas
      ref={ref}
      width={CANVAS}
      height={CANVAS}
      className="rounded-full"
      style={{ maxWidth: '100%', maxHeight: 360 }}
      aria-label="Radar scope"
    />
  )
}

// ─── Module ───────────────────────────────────────────────────────────────────

export function HeadingConflicts() {
  const [questions] = useState<Question[]>(() =>
    Array.from({ length: QUESTIONS }, (_, i) => generateQuestion(i))
  )
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores, setScores] = useState<boolean[]>([])
  const [times, setTimes] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startRef = useRef(Date.now())

  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))
  const q = questions[qIdx]

  const advance = useCallback(() => {
    setQIdx((i) => i + 1)
    setSelected(null)
    setFeedback(null)
    startRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (selected !== null) return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 1800)
  }, [selected, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  useEffect(() => {
    reset(TIME_MS)
    startRef.current = Date.now()
    const t = setTimeout(start, 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  const handleSelect = useCallback((idx: number) => {
    if (selected !== null) return
    reset()
    const elapsed = Date.now() - startRef.current
    const correct = idx === q.correctIndex
    setSelected(idx)
    setFeedback(correct)
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 1800)
  }, [selected, q, qIdx, advance, reset])

  useKeyPress('1', () => handleSelect(0), [handleSelect])
  useKeyPress('2', () => handleSelect(1), [handleSelect])
  useKeyPress('3', () => handleSelect(2), [handleSelect])
  useKeyPress('4', () => handleSelect(3), [handleSelect])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: QUESTIONS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setQIdx(0); setSelected(null); setFeedback(null)
    setScores([]); setTimes([]); setDone(false)
    setRetryKey((k) => k + 1)
  }

  if (done) {
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    return (
      <div className="min-h-screen radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen module={MODULE} score={correct} total={QUESTIONS} avgTimeMs={avg}
          personalBest={storedScore?.highScore ?? 0} onRetry={handleRetry} />
      </div>
    )
  }

  const highlightPair = feedback !== null ? q.conflictPair : null

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col gap-5">

        {/* Prompt */}
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">TASK</div>
          <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
            Which pair is on a <span className="text-[#ff3b5c]">converging course</span>?
          </h2>
          <p className="font-mono text-xs text-[#3a5068] mt-1">
            Dashed lines show heading vectors · Keys 1–4
          </p>
        </div>

        {/* Radar + options side by side on wide screens */}
        <div className="flex flex-col sm:flex-row gap-5 items-center justify-center">

          {/* Radar */}
          <AnimatePresence mode="wait">
            <motion.div key={qIdx} initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <RadarCanvas
                aircraft={q.aircraft}
                highlightPair={highlightPair}
                feedbackCorrect={feedback}
                showProjection={feedback !== null}
              />
            </motion.div>
          </AnimatePresence>

          {/* Options */}
          <div className="flex flex-col gap-2 w-full sm:w-56">
            <div className="font-mono text-[10px] text-[#3a5068] tracking-widest mb-1">SELECT PAIR</div>
            {q.options.map((pair, idx) => {
              const isSelected = selected === idx
              const isCorrect = idx === q.correctIndex
              let borderColor = '#0e2040'
              let textColor = '#c8dff0'
              let bg = '#0a1628'

              if (feedback !== null) {
                if (isCorrect) { borderColor = '#00ff9f'; textColor = '#00ff9f'; bg = '#001a0f' }
                else if (isSelected) { borderColor = '#ff3b5c'; textColor = '#ff3b5c'; bg = '#1a0008' }
              }

              return (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.07 }}
                  onClick={() => handleSelect(idx)}
                  disabled={selected !== null}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none"
                  style={{ borderColor, backgroundColor: bg }}
                  onMouseEnter={(e) => {
                    if (selected === null) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = '#00d4ff'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(0,212,255,0.18)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selected === null) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = '#0e2040'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = ''
                    }
                  }}
                  aria-label={`Option ${idx + 1}: ${q.aircraft[pair.a].id} and ${q.aircraft[pair.b].id}`}
                >
                  <span className="w-5 h-5 rounded border border-[#0e2040] flex items-center justify-center font-mono text-xs text-[#3a5068] shrink-0">
                    {idx + 1}
                  </span>
                  <span className="font-mono text-sm" style={{ color: textColor }}>
                    {q.aircraft[pair.a].id}
                    <span className="text-[#3a5068]"> — </span>
                    {q.aircraft[pair.b].id}
                  </span>
                  {feedback !== null && (
                    <span className="ml-auto font-mono text-sm">
                      {isCorrect ? '✓' : isSelected ? '✗' : ''}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
        </div>

        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? `Conflict: ${q.aircraft[q.conflictPair.a].id} — ${q.aircraft[q.conflictPair.b].id}. Follow each heading vector to where the paths intersect.`
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
