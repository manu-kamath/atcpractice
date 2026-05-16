import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE  = MODULES.find((m) => m.id === 16)!
const ROUNDS  = 8
const TIME_MS = 20_000
const CS      = 340     // canvas size
const RADAR_R = 155     // radar circle radius
const SPEED   = 7       // px/s

// Aircraft count increases each two rounds: 3, 3, 4, 4, 5, 5, 6, 6
function acCount(qi: number) { return 3 + Math.floor(qi / 2) }

const PREFIXES = ['AAL','UAL','DAL','BAW','KLM','AFR','SWA','DLH','QFA','RYR','EZY','THY']

// ─── Data generation ──────────────────────────────────────────────────────────

interface Ac { id: string; callsign: string; x: number; y: number; vx: number; vy: number; hdg: number }

interface Question {
  aircraft: Ac[]
  conflictIds: [string, string]
  instructions: string[]   // 4 options
  correctIdx: number
  explanation: string
}

function rnd(a: number, b: number) { return a + Math.random() * (b - a) }

function makeCS(used: Set<string>): string {
  let s: string
  do { s = PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + (100 + Math.floor(Math.random() * 900)) }
  while (used.has(s)); used.add(s); return s
}

function hdgToVel(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [Math.sin(r) * SPEED, -Math.cos(r) * SPEED]
}

function snap45(deg: number): number {
  const s = Math.round(deg / 45) * 45 % 360
  return s === 0 ? 360 : s
}

function fmtHdg(h: number) { return String(h).padStart(3, '0') }

function minSep(a: Ac, b: Ac, T: number): number {
  const dx = a.x - b.x, dy = a.y - b.y
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy
  const dv2 = dvx ** 2 + dvy ** 2
  if (dv2 < 1e-6) return Math.hypot(dx, dy)
  const t = Math.max(0, Math.min(T, -(dx * dvx + dy * dvy) / dv2))
  return Math.hypot(dx + t * dvx, dy + t * dvy)
}

function bearingDeg(from: Ac, to: Ac): number {
  return (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI + 360) % 360
}

function makeQuestion(qi: number): Question {
  const used = new Set<string>()
  const n = acCount(qi)
  const T = TIME_MS / 1000
  const cx = CS / 2, cy = CS / 2
  const clamp = (v: number) => Math.max(45, Math.min(CS - 45, v))

  // Conflict pair: converge on a meeting point within 6-14 s
  const meetT = rnd(6, 14)
  const mx = cx + rnd(-55, 55), my = cy + rnd(-55, 55)
  const hA = rnd(0, 360), hB = (hA + rnd(100, 200)) % 360
  const [vxA, vyA] = hdgToVel(hA), [vxB, vyB] = hdgToVel(hB)

  const ca: Ac = { id: 'ca', callsign: makeCS(used), hdg: hA, vx: vxA, vy: vyA,
    x: clamp(mx - vxA * meetT), y: clamp(my - vyA * meetT) }
  const cb: Ac = { id: 'cb', callsign: makeCS(used), hdg: hB, vx: vxB, vy: vyB,
    x: clamp(mx - vxB * meetT), y: clamp(my - vyB * meetT) }

  const all: Ac[] = [ca, cb]
  for (let att = 0; att < 600 && all.length < n; att++) {
    const h = rnd(0, 360)
    const [vx, vy] = hdgToVel(h)
    const x = clamp(cx + rnd(-RADAR_R * 0.8, RADAR_R * 0.8))
    const y = clamp(cy + rnd(-RADAR_R * 0.8, RADAR_R * 0.8))
    const c: Ac = { id: `ex${all.length - 2}`, callsign: makeCS(used), hdg: h, x, y, vx, vy }
    if (all.every(o => minSep(c, o, T) > 52)) all.push(c)
  }

  const shuffled = [...all].sort(() => Math.random() - 0.5)
  const extras = shuffled.filter(a => a.id !== 'ca' && a.id !== 'cb')

  // Correct instruction: turn ca perpendicular-away from cb
  const brg = bearingDeg(ca, cb)
  const left90  = snap45((brg - 90 + 360) % 360)
  const right90 = snap45((brg + 90) % 360)
  const correctHdg = Math.random() < 0.5 ? left90 : right90

  // Wrong options
  const towardHdg = snap45(brg)        // directly toward conflict
  const wrongExtra = (ac: Ac) => {
    // Pick a random heading that isn't the aircraft's current or correctHdg
    const pool = [45, 90, 135, 180, 225, 270, 315, 360].filter(h => h !== snap45(ac.hdg) && h !== correctHdg)
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Build 4 options as strings
  const correct = `Turn ${ca.callsign} heading ${fmtHdg(correctHdg)}`
  const wrong1  = `Turn ${ca.callsign} heading ${fmtHdg(towardHdg)}`
  const exAc1   = extras[0] ?? cb
  const exAc2   = extras[1] ?? cb
  const wrong2  = `Turn ${exAc1.callsign} heading ${fmtHdg(wrongExtra(exAc1))}`
  const wrong3  = exAc1.id !== exAc2.id
    ? `Turn ${exAc2.callsign} heading ${fmtHdg(wrongExtra(exAc2))}`
    : `Turn ${cb.callsign} heading ${fmtHdg(towardHdg)}`

  const rawOpts = [
    { text: correct, ok: true  },
    { text: wrong1,  ok: false },
    { text: wrong2,  ok: false },
    { text: wrong3,  ok: false },
  ].sort(() => Math.random() - 0.5)

  return {
    aircraft: shuffled,
    conflictIds: ['ca', 'cb'],
    instructions: rawOpts.map(o => o.text),
    correctIdx: rawOpts.findIndex(o => o.ok),
    explanation: `${ca.callsign} & ${cb.callsign} converging — turn ${ca.callsign} away`,
  }
}

function buildSession(): Question[] {
  return Array.from({ length: ROUNDS }, (_, i) => makeQuestion(i))
}

// ─── Radar canvas ─────────────────────────────────────────────────────────────

function drawRadar(
  canvas: HTMLCanvasElement,
  aircraft: Ac[],
  conflictIds: [string, string],
  answered: boolean,
  correct: boolean | null,
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const cx = W / 2, cy = H / 2
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#050d1a'; ctx.fillRect(0, 0, W, H)

  // Range rings
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, RADAR_R * i / 3, 0, Math.PI * 2)
    ctx.strokeStyle = i === 3 ? '#122040' : '#0c1a30'
    ctx.lineWidth = i === 3 ? 1.2 : 0.6; ctx.stroke()
  }

  // Cross hairs
  ctx.strokeStyle = '#0d1e35'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 6])
  ctx.beginPath()
  ctx.moveTo(cx, cy - RADAR_R); ctx.lineTo(cx, cy + RADAR_R)
  ctx.moveTo(cx - RADAR_R, cy); ctx.lineTo(cx + RADAR_R, cy)
  ctx.stroke(); ctx.setLineDash([])

  // Conflict danger line (before answer)
  if (!answered) {
    const acA = aircraft.find(a => a.id === conflictIds[0])!
    const acB = aircraft.find(a => a.id === conflictIds[1])!
    ctx.beginPath(); ctx.moveTo(acA.x, acA.y); ctx.lineTo(acB.x, acB.y)
    ctx.strokeStyle = '#ffb80030'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.stroke()
    ctx.setLineDash([])
  }

  // Aircraft
  for (const ac of aircraft) {
    const isConflict = conflictIds.includes(ac.id)
    let color = '#00d4ff'
    if (answered) {
      color = isConflict ? (correct ? '#00ff9f' : '#ff3b5c') : '#1a3550'
    } else if (isConflict) {
      color = '#ffb800'
    }

    const headRad = Math.atan2(ac.vx, -ac.vy)
    const sz = 6

    // Speed vector (look-ahead)
    ctx.beginPath(); ctx.moveTo(ac.x, ac.y)
    ctx.lineTo(ac.x + Math.cos(headRad) * 22, ac.y + Math.sin(headRad) * 22)
    ctx.strokeStyle = color + '66'; ctx.lineWidth = 1; ctx.stroke()

    // Triangle blip
    ctx.save(); ctx.translate(ac.x, ac.y); ctx.rotate(headRad)
    ctx.beginPath()
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.65, sz * 0.75); ctx.lineTo(-sz * 0.65, sz * 0.75)
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
    ctx.restore()

    // Data tag
    ctx.font = '9px "Share Tech Mono", monospace'
    ctx.textAlign = 'left'; ctx.fillStyle = color
    ctx.fillText(ac.callsign, ac.x + 10, ac.y - 2)
    if (isConflict && !answered) {
      ctx.fillStyle = color + '99'
      ctx.fillText('▲ TRAFFIC', ac.x + 10, ac.y + 9)
    }
  }
}

// ─── Module component ─────────────────────────────────────────────────────────

export function RadarControl() {
  const [questions] = useState<Question[]>(buildSession)
  const [qIdx, setQIdx]       = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores,   setScores]   = useState<boolean[]>([])
  const [times,    setTimes]    = useState<number[]>([])
  const [done,     setDone]     = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startRef  = useRef(Date.now())
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const recordResult = useStore((s) => s.recordResult)
  const storedScore  = useStore((s) => s.getModuleScore(MODULE.id))
  const q = questions[qIdx]

  // Draw radar when question or feedback changes
  useEffect(() => {
    if (canvasRef.current) {
      drawRadar(canvasRef.current, q.aircraft, q.conflictIds, feedback !== null, feedback)
    }
  }, [q, feedback])

  const advance = useCallback(() => {
    setQIdx((i) => i + 1); setSelected(null); setFeedback(null)
    startRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (selected !== null) return
    setTimes((t) => [...t, TIME_MS]); setScores((s) => [...s, false]); setFeedback(false)
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [selected, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  useEffect(() => {
    reset(TIME_MS); startRef.current = Date.now()
    const t = setTimeout(start, 50); return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  const handleSelect = useCallback((idx: number) => {
    if (selected !== null) return
    reset()
    const elapsed = Date.now() - startRef.current
    const correct = idx === q.correctIdx
    setSelected(idx); setFeedback(correct)
    setTimes((t) => [...t, elapsed]); setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [selected, q, qIdx, advance, reset])

  useKeyPress('1', () => handleSelect(0), [handleSelect])
  useKeyPress('2', () => handleSelect(1), [handleSelect])
  useKeyPress('3', () => handleSelect(2), [handleSelect])
  useKeyPress('4', () => handleSelect(3), [handleSelect])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: ROUNDS, avgTimeMs: avg, completedAt: Date.now() })
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
        <ResultsScreen module={MODULE} score={correct} total={ROUNDS} avgTimeMs={avg}
          personalBest={storedScore?.highScore ?? 0} onRetry={handleRetry} />
      </div>
    )
  }

  // Aircraft count badge (difficulty indicator)
  const acCount = q.aircraft.length

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={ROUNDS} timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col items-center gap-4">

        {/* Radar canvas — kept outside AnimatePresence so the ref is always mounted */}
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">RADAR SCOPE</div>
            <div className="font-mono text-[10px] text-[#3a5068] border border-[#0e2040] rounded px-1.5 py-0.5">
              {acCount} AIRCRAFT
            </div>
          </div>
          <canvas ref={canvasRef} width={CS} height={CS}
            className="rounded-lg border border-[#0e2040] w-full"
            style={{ maxWidth: CS, display: 'block' }} />
        </div>

        {/* Instruction buttons animate per question */}
        <AnimatePresence mode="wait">
          <motion.div key={qIdx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-4 w-full">

            {/* Instructions (amber traffic pair label) */}
            <div className="font-mono text-xs text-center text-[#ffb800]">
              Select the instruction to resolve the conflict
            </div>

            {/* 4 instruction buttons */}
            <div className="flex flex-col gap-2 w-full">
              {q.instructions.map((instr, i) => {
                const isSelected = selected === i
                const isCorrect  = i === q.correctIdx
                let border = 'border-[#0e2040]'
                let text   = 'text-[#c8dff0]'
                let bg     = ''
                if (selected !== null) {
                  if (isCorrect)           { border = 'border-[#00ff9f]'; text = 'text-[#00ff9f]'; bg = 'bg-[#001a0f]' }
                  else if (isSelected)     { border = 'border-[#ff3b5c]'; text = 'text-[#ff3b5c]'; bg = 'bg-[#1a0008]' }
                }
                return (
                  <motion.button key={i}
                    whileHover={selected === null ? { scale: 1.01 } : {}}
                    whileTap={selected === null ? { scale: 0.99 } : {}}
                    onClick={() => handleSelect(i)}
                    disabled={selected !== null}
                    className={`w-full px-4 py-3 rounded border ${border} ${text} ${bg} font-mono text-sm text-left flex items-center gap-3 transition-colors disabled:cursor-default`}>
                    <span className="text-[#3a5068] shrink-0 w-4">{i + 1}.</span>
                    <span>{instr}</span>
                    {selected !== null && isCorrect  && <span className="ml-auto">✓</span>}
                    {selected !== null && isSelected && !isCorrect && <span className="ml-auto">✗</span>}
                  </motion.button>
                )
              })}
            </div>

            <FeedbackBanner correct={feedback}
              explanation={feedback === false ? q.explanation : ''} />
          </motion.div>
        </AnimatePresence>
      </div>
    </ModuleShell>
  )
}
