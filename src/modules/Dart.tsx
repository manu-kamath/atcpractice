import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResultsScreen } from '../components/ResultsScreen'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 14)!
const ROUNDS = 8
const ROUND_MS = 25_000
const CS = 480              // canvas size (px)
const RADAR_R = 210         // radar circle radius
const MIN_SEP = 52          // conflict threshold (px)
const SPEED = 8             // all aircraft px/s
const SWEEP_DPS = 36        // degrees per second (6 RPM)
const TRAIL_STEPS = 5
const TRAIL_INT = 0.55      // seconds between trail dots
const ADVANCE_MS = 2_400

const PREFIXES = ['AAL', 'UAL', 'DAL', 'BAW', 'KLM', 'AFR', 'SWA', 'DLH', 'QFA', 'RYR', 'EZY', 'THY']
const FL_POOL  = [250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380]

// ─── Data generation ──────────────────────────────────────────────────────────

interface Ac {
  id:  string
  cs:  string   // callsign
  fl:  string   // altitude label
  x0:  number
  y0:  number
  vx:  number
  vy:  number
}

interface RoundData {
  aircraft: Ac[]
  conflictIds: [string, string]
}

function rnd(min: number, max: number) { return min + Math.random() * (max - min) }

function makeCallsign(used: Set<string>): string {
  let s: string
  do { s = PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + (100 + Math.floor(Math.random() * 900)) }
  while (used.has(s))
  used.add(s)
  return s
}

function hdgToVel(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [Math.sin(r) * SPEED, -Math.cos(r) * SPEED]
}

function minSep(a: Ac, b: Ac, T: number): number {
  const dx = a.x0 - b.x0, dy = a.y0 - b.y0
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy
  const dv2 = dvx * dvx + dvy * dvy
  if (dv2 < 1e-6) return Math.hypot(dx, dy)
  const t = Math.max(0, Math.min(T, -(dx * dvx + dy * dvy) / dv2))
  return Math.hypot(dx + t * dvx, dy + t * dvy)
}

function makeRound(): RoundData {
  const used = new Set<string>()
  const T    = ROUND_MS / 1000
  const cx   = CS / 2
  const cy   = CS / 2
  const clamp = (v: number, lo = 60, hi = CS - 60) => Math.max(lo, Math.min(hi, v))

  // Conflict pair: both converge on a crossing point within 8-14 s
  const meetT = rnd(8, 14)
  const mx = cx + rnd(-70, 70)
  const my = cy + rnd(-70, 70)
  const hA  = rnd(0, 360)
  const hB  = (hA + rnd(100, 200)) % 360
  const [vxA, vyA] = hdgToVel(hA)
  const [vxB, vyB] = hdgToVel(hB)

  const fl = () => `FL${FL_POOL[Math.floor(Math.random() * FL_POOL.length)]}`

  const ca: Ac = { id: 'ca', cs: makeCallsign(used), fl: fl(),
    x0: clamp(mx - vxA * meetT), y0: clamp(my - vyA * meetT), vx: vxA, vy: vyA }
  const cb: Ac = { id: 'cb', cs: makeCallsign(used), fl: fl(),
    x0: clamp(mx - vxB * meetT), y0: clamp(my - vyB * meetT), vx: vxB, vy: vyB }

  const all: Ac[] = [ca, cb]
  const nExtra = 2 + Math.floor(Math.random() * 2)   // 2 or 3 extras

  for (let att = 0; att < 500 && all.length < 2 + nExtra; att++) {
    const h = rnd(0, 360)
    const [vx, vy] = hdgToVel(h)
    const x0 = clamp(cx + rnd(-RADAR_R * 0.85, RADAR_R * 0.85))
    const y0 = clamp(cy + rnd(-RADAR_R * 0.85, RADAR_R * 0.85))
    const c: Ac = { id: `ex${all.length - 2}`, cs: makeCallsign(used), fl: fl(), x0, y0, vx, vy }
    if (all.every(o => minSep(c, o, T) > MIN_SEP * 1.9)) all.push(c)
  }

  return { aircraft: [...all].sort(() => Math.random() - 0.5), conflictIds: ['ca', 'cb'] }
}

// ─── Canvas drawing ────────────────────────────────────────────────────────────

type FbMode = { conflictIds: [string, string]; userIds: string[]; correct: boolean } | null

function drawFrame(
  canvas: HTMLCanvasElement,
  round: RoundData,
  elapsedSec: number,
  selected: string[],
  fb: FbMode,
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const cx = W / 2, cy = H / 2

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#050d1a'
  ctx.fillRect(0, 0, W, H)

  // Range rings
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath()
    ctx.arc(cx, cy, RADAR_R * i / 4, 0, Math.PI * 2)
    ctx.strokeStyle = i === 4 ? '#122040' : '#0c1a30'
    ctx.lineWidth = i === 4 ? 1.2 : 0.6
    ctx.stroke()
  }

  // Cross hairs
  ctx.strokeStyle = '#0d1e35'
  ctx.lineWidth = 0.5
  ctx.setLineDash([3, 6])
  ctx.beginPath()
  ctx.moveTo(cx, cy - RADAR_R); ctx.lineTo(cx, cy + RADAR_R)
  ctx.moveTo(cx - RADAR_R, cy); ctx.lineTo(cx + RADAR_R, cy)
  ctx.stroke()
  ctx.setLineDash([])

  // Center pip
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2)
  ctx.fillStyle = '#162840'; ctx.fill()

  // Sweep trail arc
  const sweepRad = (((elapsedSec * SWEEP_DPS - 90) % 360) * Math.PI) / 180
  const trailArc = Math.PI / 5
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, RADAR_R, sweepRad - trailArc, sweepRad)
  ctx.closePath()
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, RADAR_R)
  g.addColorStop(0, '#00d4ff00'); g.addColorStop(1, '#00d4ff14')
  ctx.fillStyle = g; ctx.fill()

  // Sweep line
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(sweepRad) * RADAR_R, cy + Math.sin(sweepRad) * RADAR_R)
  ctx.strokeStyle = '#00d4ff66'; ctx.lineWidth = 1.5; ctx.stroke()

  // Aircraft
  for (const ac of round.aircraft) {
    const x = ac.x0 + ac.vx * elapsedSec
    const y = ac.y0 + ac.vy * elapsedSec
    const isSelected = selected.includes(ac.id)

    let color = '#00d4ff'
    if (fb) {
      if (fb.conflictIds.includes(ac.id)) color = '#00ff9f'
      else if (fb.userIds.includes(ac.id)) color = '#ff3b5c'
      else color = '#1a3550'
    } else if (isSelected) {
      color = '#ffb800'
    }

    // Trail dots
    for (let t = 1; t <= TRAIL_STEPS; t++) {
      const ts = elapsedSec - t * TRAIL_INT
      if (ts < 0) break
      const alpha = Math.round((1 - t / (TRAIL_STEPS + 1)) * 100)
        .toString(16).padStart(2, '0')
      ctx.beginPath()
      ctx.arc(ac.x0 + ac.vx * ts, ac.y0 + ac.vy * ts, 2.2 - t * 0.3, 0, Math.PI * 2)
      ctx.fillStyle = color + alpha
      ctx.fill()
    }

    // Speed vector
    const vMag = Math.hypot(ac.vx, ac.vy)
    const vecLen = 20
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (ac.vx / vMag) * vecLen, y + (ac.vy / vMag) * vecLen)
    ctx.strokeStyle = color + '77'; ctx.lineWidth = 1; ctx.stroke()

    // Blip (triangle pointing in direction of travel)
    const headRad = Math.atan2(ac.vx, -ac.vy)
    const sz = 6
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(headRad)
    ctx.beginPath()
    ctx.moveTo(0, -sz)
    ctx.lineTo(sz * 0.65, sz * 0.75)
    ctx.lineTo(-sz * 0.65, sz * 0.75)
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()

    // Selection ring
    if (isSelected && !fb) {
      ctx.beginPath(); ctx.arc(0, 0, sz + 5, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffb800'; ctx.lineWidth = 1.5; ctx.stroke()
    }
    ctx.restore()

    // Data tag
    ctx.font = '9px "Share Tech Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = color
    ctx.fillText(ac.cs, x + 11, y - 2)
    ctx.fillStyle = color + '88'
    ctx.fillText(ac.fl, x + 11, y + 9)
  }

  // Feedback: dashed ellipse around conflict midpoint
  if (fb) {
    const acA = round.aircraft.find(a => a.id === fb.conflictIds[0])!
    const acB = round.aircraft.find(a => a.id === fb.conflictIds[1])!
    const xA = acA.x0 + acA.vx * elapsedSec
    const yA = acA.y0 + acA.vy * elapsedSec
    const xB = acB.x0 + acB.vx * elapsedSec
    const yB = acB.y0 + acB.vy * elapsedSec
    const midX = (xA + xB) / 2, midY = (yA + yB) / 2
    const r = Math.max(Math.hypot(xA - xB, yA - yB) / 2 + 18, 24)
    ctx.beginPath(); ctx.arc(midX, midY, r, 0, Math.PI * 2)
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = '#00ff9f44'; ctx.lineWidth = 1; ctx.stroke()
    ctx.setLineDash([])
  }
}

// ─── Module component ─────────────────────────────────────────────────────────

type Phase = 'intro' | 'running' | 'feedback' | 'done'

export function Dart() {
  const navigate = useNavigate()
  const { recordResult, getModuleScore } = useStore()

  const [rounds]   = useState<RoundData[]>(() => Array.from({ length: ROUNDS }, makeRound))
  const [roundIdx, setRoundIdx] = useState(0)
  const [phase,    setPhase]    = useState<Phase>('intro')
  const [selected, setSelected] = useState<string[]>([])
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores,   setScores]   = useState<boolean[]>([])
  const [times,    setTimes]    = useState<number[]>([])
  const [done,     setDone]     = useState(false)
  const [timeLeft, setTimeLeft] = useState(ROUND_MS)

  // Mutable refs shared between RAF callback and event handlers
  const canvasRef        = useRef<HTMLCanvasElement>(null)
  const rafRef           = useRef<number | null>(null)
  const roundStartRef    = useRef(0)
  const selectedRef      = useRef<string[]>([])
  const phaseRef         = useRef<Phase>('intro')
  const roundIdxRef      = useRef(0)
  const fbElapsedRef     = useRef(0)

  const endRound = useCallback((correct: boolean, elapsedMs: number) => {
    if (phaseRef.current !== 'running') return
    phaseRef.current = 'feedback'
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    fbElapsedRef.current = elapsedMs / 1000

    setPhase('feedback')
    setFeedback(correct)
    setScores((s) => [...s, correct])
    setTimes((t) => [...t, elapsedMs])

    // Draw static feedback frame
    if (canvasRef.current) {
      const r = rounds[roundIdxRef.current]
      drawFrame(canvasRef.current, r, fbElapsedRef.current, selectedRef.current,
        { conflictIds: r.conflictIds, userIds: selectedRef.current, correct })
    }

    setTimeout(() => {
      const next = roundIdxRef.current + 1
      if (next >= ROUNDS) {
        setDone(true)
        return
      }
      roundIdxRef.current = next
      selectedRef.current = []
      phaseRef.current    = 'running'
      roundStartRef.current = performance.now()
      setRoundIdx(next)
      setSelected([])
      setFeedback(null)
      setTimeLeft(ROUND_MS)
      setPhase('running')   // triggers useEffect → new RAF loop
    }, ADVANCE_MS)
  }, [rounds])

  // RAF animation loop
  useEffect(() => {
    if (phase !== 'running') return

    const tick = (now: number) => {
      if (phaseRef.current !== 'running') return
      const elapsed = now - roundStartRef.current
      const tl = Math.max(0, ROUND_MS - elapsed)
      setTimeLeft(tl)

      if (canvasRef.current) {
        drawFrame(canvasRef.current, rounds[roundIdxRef.current],
          elapsed / 1000, selectedRef.current, null)
      }

      if (tl === 0) { endRound(false, ROUND_MS); return }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [phase, endRound, rounds])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Canvas click handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'running') return
    const rect = canvasRef.current!.getBoundingClientRect()
    const scaleX = CS / rect.width, scaleY = CS / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top)  * scaleY
    const elSec = (performance.now() - roundStartRef.current) / 1000

    const round = rounds[roundIdxRef.current]
    let hit: string | null = null
    for (const ac of round.aircraft) {
      const x = ac.x0 + ac.vx * elSec
      const y = ac.y0 + ac.vy * elSec
      if (Math.hypot(mx - x, my - y) < 22) { hit = ac.id; break }
    }
    if (!hit) return

    const prev = selectedRef.current
    if (prev.includes(hit)) {
      selectedRef.current = prev.filter(id => id !== hit)
      setSelected([...selectedRef.current])
      return
    }

    // Max 2 selected; push and evict oldest if already 2
    const next = prev.length < 2 ? [...prev, hit] : [prev[1], hit]
    selectedRef.current = next
    setSelected([...next])

    if (next.length === 2) {
      const [ci1, ci2] = round.conflictIds
      const correct = next.includes(ci1) && next.includes(ci2)
      endRound(correct, performance.now() - roundStartRef.current)
    }
  }, [rounds, endRound])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: ROUNDS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const storedScore   = getModuleScore(MODULE.id)
  const currentRound  = rounds[roundIdx]
  const timePct       = timeLeft / ROUND_MS
  const selCallsigns  = selected.map(id => currentRound.aircraft.find(a => a.id === id)?.cs ?? '')
  const confCallsigns = currentRound.conflictIds.map(id => currentRound.aircraft.find(a => a.id === id)?.cs ?? '')

  const handleRetry = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    phaseRef.current = 'intro'; roundIdxRef.current = 0
    selectedRef.current = []
    setRoundIdx(0); setPhase('intro'); setSelected([])
    setFeedback(null); setScores([]); setTimes([])
    setDone(false); setTimeLeft(ROUND_MS)
  }

  // ── Done ────────────────────────────────────────────────────────────────────
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

  // ── Intro ───────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040]">
          <button onClick={() => navigate('/')}
            className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors">← HOME</button>
          <div className="text-center">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">{MODULE.stage}</div>
            <div className="font-ui text-sm font-medium text-[#c8dff0]">{MODULE.name}</div>
          </div>
          <div className="w-16" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 max-w-lg mx-auto text-center">
          <div className="space-y-2">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">STAGE II · MODULE 14</div>
            <h1 className="text-2xl font-semibold text-[#c8dff0]">Dynamic Radar Test (DART)</h1>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left max-w-sm w-full">
            {[
              { icon: '📡', t: 'Live Radar', d: '4–5 aircraft moving in real time on the scope.' },
              { icon: '⚠️', t: 'One Conflict', d: 'Exactly one pair will violate minimum separation.' },
              { icon: '🖱️', t: 'Click to Identify', d: 'Click Aircraft 1, then Aircraft 2 to flag the pair.' },
              { icon: '⏱️', t: '25 Seconds', d: 'Identify the conflict before the timer expires.' },
            ].map(({ icon, t, d }) => (
              <div key={t} className="flex gap-3 p-3 rounded border border-[#0e2040] bg-[#0a1628]">
                <span className="text-lg">{icon}</span>
                <div>
                  <div className="font-mono text-xs text-[#00d4ff]">{t}</div>
                  <div className="font-ui text-xs text-[#3a5068] mt-0.5">{d}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              phaseRef.current = 'running'
              roundStartRef.current = performance.now()
              setPhase('running')
            }}
            className="px-10 py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors"
          >
            BEGIN SESSION
          </button>
          <p className="font-mono text-xs text-[#3a5068]">
            Unofficial practice tool — not affiliated with EUROCONTROL, SkyTest, or Nav Canada
          </p>
        </div>
      </div>
    )
  }

  // ── Running / Feedback ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#050d1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#0e2040]">
        <button onClick={() => navigate('/')}
          className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors">← HOME</button>
        <div className="font-mono text-xs text-[#3a5068] tracking-wider">
          DART · ROUND {roundIdx + 1}/{ROUNDS}
        </div>
        <div className="flex items-center gap-2">
          <div className="font-mono text-xs w-6 text-right" style={{
            color: timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c',
          }}>
            {Math.ceil(timeLeft / 1000)}
          </div>
          <div className="w-20 h-1.5 rounded bg-[#0a1628] overflow-hidden">
            <div className="h-full rounded transition-all duration-100" style={{
              width: `${timePct * 100}%`,
              backgroundColor: timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c',
            }} />
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex justify-center px-2 pt-2">
        <canvas
          ref={canvasRef}
          width={CS}
          height={CS}
          onClick={handleCanvasClick}
          className="rounded-lg border border-[#0e2040] w-full cursor-crosshair"
          style={{ maxWidth: CS, display: 'block' }}
        />
      </div>

      {/* Status / Feedback */}
      <div className="px-4 pt-3 pb-4 space-y-2">
        {phase === 'running' && (
          <div className="text-center font-mono text-xs">
            {selected.length === 0 && (
              <span className="text-[#3a5068]">Click the two aircraft that will conflict</span>
            )}
            {selected.length === 1 && (
              <span className="text-[#ffb800]">
                {selCallsigns[0]} selected — click the second aircraft
              </span>
            )}
          </div>
        )}
        {phase === 'feedback' && feedback !== null && (
          <FeedbackBanner
            correct={feedback}
            explanation={feedback ? '' : `Conflict pair: ${confCallsigns[0]} ↔ ${confCallsigns[1]}`}
          />
        )}
      </div>
    </div>
  )
}
