import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 12)!
const ROUNDS = 8
const TIME_MS = 3_000
const ADVANCE_DELAY = 1_600

// Easy headings for rounds 1-4, any 45° increment for 5-8
const EASY = [0, 90, 180, 270]
const FULL = [0, 45, 90, 135, 180, 225, 270, 315]

interface Question {
  twoEngineSide: 'left' | 'right'  // aircraft's port/starboard
  heading: number                   // degrees CW from north (screen up = 0°)
}

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function buildSession(): Question[] {
  return Array.from({ length: ROUNDS }, (_, i) => ({
    twoEngineSide: Math.random() < 0.5 ? 'left' : 'right',
    heading: randItem(i < 4 ? EASY : FULL),
  }))
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────

const SIZE = 270

function drawAircraft(
  canvas: HTMLCanvasElement,
  twoEngineSide: 'left' | 'right',
  heading: number,
  state: 'idle' | 'correct' | 'wrong',
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Background
  ctx.fillStyle = '#060e1c'
  ctx.fillRect(0, 0, W, H)

  // Subtle dot grid
  ctx.fillStyle = '#0d1f33'
  for (let x = 18; x < W; x += 18) {
    for (let y = 18; y < H; y += 18) {
      ctx.beginPath()
      ctx.arc(x, y, 0.7, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const bodyColor =
    state === 'correct' ? '#00ff9f'
    : state === 'wrong'  ? '#ff3b5c'
    : '#00d4ff'

  const featureColor = '#ffb800'
  const dimColor = '#2a4060'

  ctx.save()
  ctx.translate(W / 2, H / 2)
  // heading=0 → nose points UP (screen top). Rotate CW by heading degrees.
  ctx.rotate((heading * Math.PI) / 180)

  // Helper: stroke + faint fill a path
  function fillStroke(color: string, alpha = 0.08) {
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0')
    ctx.fill()
    ctx.strokeStyle = color
    ctx.stroke()
  }

  ctx.lineWidth = 1.8

  // ── Fuselage ─────────────────────────────────────────────────────────────────
  // Nose-up canonical: nose at top (negative y), tail at bottom (positive y)
  ctx.beginPath()
  ctx.moveTo(0, -58)              // nose tip
  ctx.lineTo(9, -40)
  ctx.lineTo(9, 15)
  ctx.lineTo(6, 38)
  ctx.lineTo(0, 50)               // tail tip
  ctx.lineTo(-6, 38)
  ctx.lineTo(-9, 15)
  ctx.lineTo(-9, -40)
  ctx.closePath()
  fillStroke(bodyColor)

  // ── Wings ──────────────────────────────────────────────────────────────────────
  // Left wing (aircraft port — negative x side)
  ctx.beginPath()
  ctx.moveTo(-9, -8)
  ctx.lineTo(-72, 22)
  ctx.lineTo(-68, 33)
  ctx.lineTo(-9, 8)
  ctx.closePath()
  fillStroke(bodyColor)

  // Right wing (aircraft starboard — positive x side)
  ctx.beginPath()
  ctx.moveTo(9, -8)
  ctx.lineTo(72, 22)
  ctx.lineTo(68, 33)
  ctx.lineTo(9, 8)
  ctx.closePath()
  fillStroke(bodyColor)

  // ── Horizontal stabilizers ─────────────────────────────────────────────────────
  ctx.beginPath()
  ctx.moveTo(-9, 36)
  ctx.lineTo(-30, 46)
  ctx.lineTo(-28, 52)
  ctx.lineTo(-9, 44)
  ctx.closePath()
  fillStroke(bodyColor, 0.1)

  ctx.beginPath()
  ctx.moveTo(9, 36)
  ctx.lineTo(30, 46)
  ctx.lineTo(28, 52)
  ctx.lineTo(9, 44)
  ctx.closePath()
  fillStroke(bodyColor, 0.1)

  // ── Engine pods ────────────────────────────────────────────────────────────────
  // Canonical positions along wings (inboard and outboard)
  // Left wing nacelle positions
  const leftNacelles: [number, number][] =
    twoEngineSide === 'left'
      ? [[-28, 8], [-50, 19]]   // 2 engines
      : [[-39, 14]]              // 1 engine

  const rightNacelles: [number, number][] =
    twoEngineSide === 'right'
      ? [[28, 8], [50, 19]]     // 2 engines
      : [[39, 14]]               // 1 engine

  function drawNacelle(x: number, y: number, color: string) {
    ctx.beginPath()
    ctx.ellipse(x, y, 4.5, 10, 0, 0, Math.PI * 2)
    ctx.fillStyle = color + '44'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.8
    ctx.stroke()
  }

  const leftColor  = twoEngineSide === 'left'  ? featureColor : dimColor
  const rightColor = twoEngineSide === 'right' ? featureColor : dimColor

  for (const [x, y] of leftNacelles)  drawNacelle(x, y, leftColor)
  for (const [x, y] of rightNacelles) drawNacelle(x, y, rightColor)

  ctx.restore()

  // ── Legend ─────────────────────────────────────────────────────────────────────
  // Amber dot + label for the 2-engine side (shown before answer)
  if (state === 'idle') {
    ctx.fillStyle = featureColor
    ctx.font = '9px "Share Tech Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText('2 ENGINES', W / 2, H - 8)
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

type AnswerState = 'idle' | 'correct' | 'wrong'

export function SpotTheSide() {
  const [questions] = useState<Question[]>(buildSession)
  const [qIdx, setQIdx] = useState(0)
  const [answerState, setAnswerState] = useState<AnswerState>('idle')
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores, setScores] = useState<boolean[]>([])
  const [times, setTimes] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startRef = useRef(Date.now())
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))
  const q = questions[qIdx]

  // Redraw canvas whenever question or answer state changes
  useEffect(() => {
    if (canvasRef.current) drawAircraft(canvasRef.current, q.twoEngineSide, q.heading, answerState)
  }, [q, answerState])

  const advance = useCallback(() => {
    setQIdx((i) => i + 1)
    setAnswerState('idle')
    setFeedback(null)
    startRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (answerState !== 'idle') return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setAnswerState('wrong')
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, ADVANCE_DELAY)
  }, [answerState, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  useEffect(() => {
    reset(TIME_MS)
    startRef.current = Date.now()
    const t = setTimeout(start, 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  const handleSelect = useCallback((side: 'left' | 'right') => {
    if (answerState !== 'idle') return
    reset()
    const elapsed = Date.now() - startRef.current
    const correct = side === q.twoEngineSide
    setAnswerState(correct ? 'correct' : 'wrong')
    setFeedback(correct)
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, ADVANCE_DELAY)
  }, [answerState, q, qIdx, advance, reset])

  useKeyPress('1', () => handleSelect('left'), [handleSelect])
  useKeyPress('2', () => handleSelect('right'), [handleSelect])
  useKeyPress('ArrowLeft', () => handleSelect('left'), [handleSelect])
  useKeyPress('ArrowRight', () => handleSelect('right'), [handleSelect])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: ROUNDS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setQIdx(0); setAnswerState('idle'); setFeedback(null)
    setScores([]); setTimes([]); setDone(false)
    setRetryKey((k) => k + 1)
  }

  if (done) {
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    return (
      <div className="min-h-screen radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen
          module={MODULE}
          score={correct}
          total={ROUNDS}
          avgTimeMs={avg}
          personalBest={storedScore?.highScore ?? 0}
          onRetry={handleRetry}
        />
      </div>
    )
  }

  const explanation =
    `The 2-engine wing was the aircraft's ${q.twoEngineSide.toUpperCase()} side`

  return (
    <ModuleShell
      module={MODULE}
      questionNum={qIdx + 1}
      total={ROUNDS}
      timerPct={pct}
      timerRemaining={remaining}
    >
      <div className="flex flex-col items-center gap-6">

        {/* Question prompt */}
        <div className="text-center space-y-1">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">IDENTIFY AIRCRAFT SIDE</div>
          <p className="font-ui text-sm text-[#c8dff0]">
            The wing with <span className="text-[#ffb800] font-semibold">2 engines</span> is the aircraft's:
          </p>
        </div>

        {/* Canvas — outside AnimatePresence so the ref is always mounted */}
        <div
          className="rounded-lg overflow-hidden border border-[#0e2040]"
          style={{ width: SIZE, height: SIZE }}
        >
          <canvas ref={canvasRef} width={SIZE} height={SIZE} />
        </div>

        {/* Buttons and feedback animate per question */}
        <AnimatePresence mode="wait">
          <motion.div
            key={qIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center gap-6 w-full"
          >
            {/* Buttons */}
            <div className="flex gap-4 w-full max-w-xs">
              {(['left', 'right'] as const).map((side) => {
                const isAnswer = side === q.twoEngineSide
                let border = 'border-[#0e2040]'
                let text = 'text-[#c8dff0]'
                let bg = ''
                if (answerState !== 'idle') {
                  if (isAnswer) { border = 'border-[#00ff9f]'; text = 'text-[#00ff9f]'; bg = 'bg-[#001a0f]' }
                }

                return (
                  <motion.button
                    key={side}
                    whileHover={answerState === 'idle' ? { scale: 1.04 } : {}}
                    whileTap={answerState === 'idle' ? { scale: 0.97 } : {}}
                    onClick={() => handleSelect(side)}
                    disabled={answerState !== 'idle'}
                    className={`flex-1 py-4 rounded border ${border} ${text} ${bg} font-mono font-bold text-sm tracking-widest transition-colors disabled:cursor-default`}
                  >
                    <div>{side.toUpperCase()}</div>
                    <div className="text-xs font-normal opacity-50 mt-0.5">
                      {side === 'left' ? '← key 1' : 'key 2 →'}
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Feedback */}
            <div className="w-full">
              <FeedbackBanner
                correct={feedback}
                explanation={feedback === false ? explanation : ''}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </ModuleShell>
  )
}
