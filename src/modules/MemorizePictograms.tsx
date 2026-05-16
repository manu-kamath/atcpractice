import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 9)!
const ROUNDS = 8
const STUDY_MS = 3500
const RECALL_MS = 20000

// ─── Symbol definitions ───────────────────────────────────────────────────────

type SymId = 'RWY' | 'AC' | 'WPT' | 'VOR' | 'NDB' | 'BCN' | 'HLD' | 'TWR' | 'WND' | 'RDR'

const ALL_SYMBOLS: SymId[] = ['RWY', 'AC', 'WPT', 'VOR', 'NDB', 'BCN', 'HLD', 'TWR', 'WND', 'RDR']

const SYM_LABELS: Record<SymId, string> = {
  RWY: 'RUNWAY', AC: 'AIRCRAFT', WPT: 'WAYPOINT', VOR: 'VOR', NDB: 'NDB',
  BCN: 'BEACON', HLD: 'HOLD', TWR: 'TOWER', WND: 'WIND', RDR: 'RADAR',
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawSymbol(ctx: CanvasRenderingContext2D, id: SymId, cx: number, cy: number, r: number, color: string) {
  ctx.strokeStyle = color
  ctx.fillStyle = `${color}22`
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (id) {
    case 'RWY': {
      // Runway: rectangle with threshold bars
      const w = r * 0.35, h = r * 0.85
      ctx.fillRect(cx - w, cy - h, w * 2, h * 2)
      ctx.strokeRect(cx - w, cy - h, w * 2, h * 2)
      // Centre line dashes
      ctx.setLineDash([5, 5])
      ctx.beginPath(); ctx.moveTo(cx, cy - h + 4); ctx.lineTo(cx, cy + h - 4); ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case 'AC': {
      // Top-down aircraft silhouette
      ctx.beginPath()
      ctx.moveTo(cx, cy - r * 0.8)        // nose
      ctx.lineTo(cx + r * 0.15, cy)
      ctx.lineTo(cx + r * 0.85, cy + r * 0.35)   // right wing tip
      ctx.lineTo(cx + r * 0.6, cy + r * 0.5)
      ctx.lineTo(cx + r * 0.15, cy + r * 0.35)
      ctx.lineTo(cx + r * 0.25, cy + r * 0.8)    // right tail
      ctx.lineTo(cx, cy + r * 0.65)
      ctx.lineTo(cx - r * 0.25, cy + r * 0.8)    // left tail
      ctx.lineTo(cx - r * 0.15, cy + r * 0.35)
      ctx.lineTo(cx - r * 0.6, cy + r * 0.5)
      ctx.lineTo(cx - r * 0.85, cy + r * 0.35)   // left wing tip
      ctx.lineTo(cx - r * 0.15, cy)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
      break
    }
    case 'WPT': {
      // Filled triangle pointing up
      ctx.beginPath()
      ctx.moveTo(cx, cy - r * 0.85)
      ctx.lineTo(cx + r * 0.75, cy + r * 0.6)
      ctx.lineTo(cx - r * 0.75, cy + r * 0.6)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      break
    }
    case 'VOR': {
      // Hexagon with centre dot
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6
        const x = cx + Math.cos(a) * r * 0.8, y = cy + Math.sin(a) * r * 0.8
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'NDB': {
      // Circle with inner cross
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.5, cy); ctx.lineTo(cx + r * 0.5, cy)
      ctx.moveTo(cx, cy - r * 0.5); ctx.lineTo(cx, cy + r * 0.5)
      ctx.stroke()
      break
    }
    case 'BCN': {
      // 6-point star (beacon flash)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85)
        ctx.stroke()
      }
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'HLD': {
      // Racetrack hold pattern oval
      ctx.beginPath()
      ctx.ellipse(cx, cy, r * 0.7, r * 0.45, 0, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
      // Arrow on right curve
      const ax = cx + r * 0.7, ay = cy
      ctx.beginPath()
      ctx.moveTo(ax - 6, ay - 5); ctx.lineTo(ax, ay); ctx.lineTo(ax - 6, ay + 5)
      ctx.stroke()
      break
    }
    case 'TWR': {
      // Control tower: vertical bar + wider base + cab top
      const tw = r * 0.22, th = r * 1.2
      ctx.fillRect(cx - tw, cy - th * 0.5, tw * 2, th * 0.75)
      ctx.strokeRect(cx - tw, cy - th * 0.5, tw * 2, th * 0.75)
      // Base
      ctx.fillRect(cx - r * 0.5, cy + th * 0.25 - 2, r, r * 0.25)
      ctx.strokeRect(cx - r * 0.5, cy + th * 0.25 - 2, r, r * 0.25)
      // Cab (wider top)
      ctx.fillRect(cx - r * 0.38, cy - th * 0.5 - r * 0.22, r * 0.76, r * 0.22)
      ctx.strokeRect(cx - r * 0.38, cy - th * 0.5 - r * 0.22, r * 0.76, r * 0.22)
      break
    }
    case 'WND': {
      // Wind arrow pointing up-right with barbs
      const len = r * 0.85
      const a = -Math.PI / 4    // up-right
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len
      const sx = cx - Math.cos(a) * len * 0.3, sy = cy - Math.sin(a) * len * 0.3
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      // Arrowhead
      const ha = 0.4
      ctx.beginPath()
      ctx.moveTo(ex, ey)
      ctx.lineTo(ex - Math.cos(a - ha) * r * 0.3, ey - Math.sin(a - ha) * r * 0.3)
      ctx.lineTo(ex - Math.cos(a + ha) * r * 0.3, ey - Math.sin(a + ha) * r * 0.3)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      // Wind barbs
      for (let b = 0; b < 2; b++) {
        const t = 0.3 + b * 0.35
        const bx = sx + (ex - sx) * t, by = sy + (ey - sy) * t
        const ba = a + Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx + Math.cos(ba) * r * 0.3, by + Math.sin(ba) * r * 0.3)
        ctx.stroke()
      }
      break
    }
    case 'RDR': {
      // Radar sector sweep
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r * 0.82, -Math.PI * 0.15, Math.PI * 0.5)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      // Concentric arcs
      for (const fr of [0.4, 0.65]) {
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.82 * fr, -Math.PI * 0.15, Math.PI * 0.5)
        ctx.stroke()
      }
      // Sweep line
      ctx.strokeStyle = color; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(Math.PI * 0.25) * r * 0.82, cy + Math.sin(Math.PI * 0.25) * r * 0.82)
      ctx.stroke()
      break
    }
  }
}

function renderSym(canvas: HTMLCanvasElement, id: SymId, highlight = false, dim = false) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = highlight ? '#001a0f' : dim ? '#050d1a' : '#080f1e'
  ctx.fillRect(0, 0, W, H)
  const color = highlight ? '#00ff9f' : dim ? 'rgba(0,212,255,0.25)' : '#00d4ff'
  drawSymbol(ctx, id, W / 2, H / 2, W * 0.38, color)
}

// ─── Symbol tile ──────────────────────────────────────────────────────────────

function SymTile({
  id, size = 72, highlight = false, dim = false,
  seqNum, onClick, disabled,
}: {
  id: SymId; size?: number; highlight?: boolean; dim?: boolean
  seqNum?: number; onClick?: () => void; disabled?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) renderSym(ref.current, id, highlight, dim) }, [id, highlight, dim])

  const content = (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        {seqNum !== undefined && (
          <div className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-[#00d4ff] text-[#050d1a] font-mono text-[10px] font-bold flex items-center justify-center z-10">
            {seqNum}
          </div>
        )}
        <canvas ref={ref} width={size} height={size}
          className="rounded-lg border"
          style={{ borderColor: highlight ? '#00ff9f' : dim ? '#0e2040' : '#0e2040' }} />
      </div>
      <span className="font-mono text-[9px]" style={{ color: dim ? '#1a3050' : '#3a5068' }}>
        {SYM_LABELS[id]}
      </span>
    </div>
  )

  if (!onClick) return content

  return (
    <motion.button
      whileTap={!disabled ? { scale: 0.93 } : {}}
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer disabled:cursor-default focus:outline-none"
      aria-label={SYM_LABELS[id]}
    >
      {content}
    </motion.button>
  )
}

// ─── Question generation ──────────────────────────────────────────────────────

interface Round {
  sequence: SymId[]   // what to memorise (4-6 items)
  pool: SymId[]       // shuffled pool including distractors
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateRound(rIdx: number): Round {
  const seqLen = rIdx < 3 ? 4 : rIdx < 6 ? 5 : 6
  const sequence = shuffle([...ALL_SYMBOLS]).slice(0, seqLen) as SymId[]
  // Pool = sequence + enough distractors to fill 10 total (no repeats from sequence)
  const distractors = shuffle(ALL_SYMBOLS.filter((s) => !sequence.includes(s as SymId)))
    .slice(0, 10 - seqLen) as SymId[]
  const pool = shuffle([...sequence, ...distractors]) as SymId[]
  return { sequence, pool }
}

// ─── Module ───────────────────────────────────────────────────────────────────

type Phase = 'study' | 'recall' | 'feedback'

export function MemorizePictograms() {
  const [rounds] = useState<Round[]>(() =>
    Array.from({ length: ROUNDS }, (_, i) => generateRound(i))
  )
  const [rIdx, setRIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('study')
  const [clicks, setClicks] = useState<SymId[]>([])
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores, setScores] = useState<boolean[]>([])
  const [times, setTimes] = useState<number[]>([])
  const [studyCd, setStudyCd] = useState(STUDY_MS / 1000)
  const [done, setDone] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startRef = useRef(Date.now())

  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))
  const round = rounds[rIdx]

  const advance = useCallback(() => {
    setRIdx((i) => i + 1)
    setPhase('study')
    setClicks([])
    setFeedback(null)
    setStudyCd(STUDY_MS / 1000)
  }, [])

  // Study countdown
  useEffect(() => {
    if (phase !== 'study') return
    setStudyCd(STUDY_MS / 1000)
    const tick = setInterval(() => setStudyCd((c) => +(Math.max(0, c - 0.1)).toFixed(1)), 100)
    const t = setTimeout(() => { clearInterval(tick); setPhase('recall'); startRef.current = Date.now() }, STUDY_MS)
    return () => { clearTimeout(t); clearInterval(tick) }
  }, [phase, rIdx, retryKey])

  const finishRound = useCallback((correct: boolean) => {
    const elapsed = Date.now() - startRef.current
    setFeedback(correct)
    setPhase('feedback')
    setScores((s) => [...s, correct])
    setTimes((t) => [...t, elapsed])
    setTimeout(() => { if (rIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [rIdx, advance])

  const handleExpire = useCallback(() => {
    if (phase !== 'recall') return
    finishRound(false)
  }, [phase, finishRound])

  const { remaining, pct, start, reset } = useTimer(RECALL_MS, handleExpire)

  useEffect(() => {
    if (phase !== 'recall') { reset(RECALL_MS); return }
    const t = setTimeout(start, 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, rIdx, retryKey])

  const handleClick = useCallback((sym: SymId) => {
    if (phase !== 'recall') return
    const next = [...clicks, sym]
    const pos = next.length - 1

    if (sym !== round.sequence[pos]) {
      // Wrong symbol — immediate fail
      reset()
      setClicks(next)
      finishRound(false)
      return
    }

    if (next.length === round.sequence.length) {
      // Sequence complete and all correct
      reset()
      setClicks(next)
      finishRound(true)
      return
    }

    setClicks(next)
  }, [phase, clicks, round, finishRound, reset])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: ROUNDS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setRIdx(0); setPhase('study'); setClicks([]); setFeedback(null)
    setScores([]); setTimes([]); setDone(false); setStudyCd(STUDY_MS / 1000)
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

  const isStudy = phase === 'study'
  const clickedIds = new Set(clicks)
  const wrongIdx = phase === 'feedback' && feedback === false ? clicks.length - 1 : -1

  return (
    <ModuleShell module={MODULE} questionNum={rIdx + 1} total={ROUNDS}
      timerPct={isStudy ? (studyCd / (STUDY_MS / 1000)) * 100 : pct}
      timerRemaining={isStudy ? studyCd * 1000 : remaining}>
      <div className="flex flex-col gap-6">

        {/* Phase header */}
        <AnimatePresence mode="wait">
          <motion.div key={phase} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="text-center">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">
              {isStudy ? 'STUDY PHASE' : phase === 'recall' ? 'RECALL PHASE' : 'RESULT'}
            </div>
            <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
              {isStudy
                ? <><span className="text-[#00d4ff]">Memorise</span> the sequence — {studyCd.toFixed(1)}s</>
                : 'Reproduce the sequence in order'}
            </h2>
            <p className="font-mono text-xs text-[#3a5068] mt-1">
              {isStudy
                ? `${round.sequence.length} symbols · hides in ${studyCd.toFixed(1)}s`
                : `Click symbols 1 → ${round.sequence.length} in order`}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Sequence display (study) or progress tracker (recall) */}
        <div className="flex justify-center">
          {isStudy ? (
            // Full sequence with position numbers
            <AnimatePresence mode="wait">
              <motion.div key={rIdx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex gap-3 flex-wrap justify-center">
                {round.sequence.map((sym, i) => (
                  <SymTile key={i} id={sym} size={72} seqNum={i + 1} />
                ))}
              </motion.div>
            </AnimatePresence>
          ) : (
            // Recall progress: slots showing what user has clicked
            <div className="flex gap-2 flex-wrap justify-center">
              {round.sequence.map((_, i) => {
                const clicked = clicks[i]
                const isWrong = i === wrongIdx
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="w-14 h-14 rounded-lg border flex items-center justify-center font-mono text-xs transition-all"
                      style={{
                        borderColor: clicked
                          ? isWrong ? '#ff3b5c' : '#00ff9f'
                          : '#0e2040',
                        background: clicked
                          ? isWrong ? '#1a0008' : '#001a0f'
                          : '#0a1628',
                        color: clicked
                          ? isWrong ? '#ff3b5c' : '#00ff9f'
                          : '#3a5068',
                      }}
                    >
                      {clicked ? (isWrong ? '✗' : SYM_LABELS[clicked].slice(0, 3)) : i + 1}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Symbol pool (recall phase) */}
        <AnimatePresence>
          {!isStudy && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap gap-2 justify-center">
              {round.pool.map((sym) => {
                const alreadyUsed = clickedIds.has(sym) && round.sequence.slice(0, clicks.length).includes(sym)
                return (
                  <SymTile
                    key={sym}
                    id={sym}
                    size={64}
                    dim={alreadyUsed || phase === 'feedback'}
                    highlight={phase === 'feedback' && feedback === true && round.sequence.includes(sym)}
                    onClick={!alreadyUsed && phase === 'recall' ? () => handleClick(sym) : undefined}
                    disabled={alreadyUsed || phase === 'feedback'}
                  />
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? `Correct sequence: ${round.sequence.join(' → ')}`
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
