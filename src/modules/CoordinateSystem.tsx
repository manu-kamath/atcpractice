import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 2)!
const QUESTIONS = 8
const TIME_MS = 10000

interface Point { x: number; y: number }
interface Question {
  point: Point
  options: Point[]
  correctIndex: number
  range: number   // grid goes from -range to +range
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function ptKey(p: Point) { return `${p.x},${p.y}` }

function generateQuestion(qNum: number): Question {
  // Difficulty scales with question number: small range early, larger range and closer distractors later
  const range = qNum < 3 ? 5 : qNum < 6 ? 8 : 10

  const point: Point = {
    x: randInt(-range, range),
    y: randInt(-range, range),
  }

  const options: Point[] = [point]
  const spread = qNum < 3 ? 3 : qNum < 6 ? 2 : 1   // distractor proximity shrinks

  while (options.length < 4) {
    const dx = randInt(-spread, spread)
    const dy = randInt(-spread, spread)
    if (dx === 0 && dy === 0) continue
    const candidate: Point = {
      x: Math.max(-range, Math.min(range, point.x + dx)),
      y: Math.max(-range, Math.min(range, point.y + dy)),
    }
    if (!options.some((o) => ptKey(o) === ptKey(candidate))) {
      options.push(candidate)
    }
  }

  // Shuffle
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }

  const correctIndex = options.findIndex((o) => ptKey(o) === ptKey(point))
  return { point, options, correctIndex, range }
}

// ─── Grid Canvas ────────────────────────────────────────────────────────────

interface GridProps {
  question: Question
  feedback: boolean | null
  selected: number | null
}

function GridCanvas({ question, feedback, selected }: GridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { point, range } = question

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H / 2
    const step = W / (range * 2 + 2)   // pixels per unit

    const toCanvas = (v: number, origin: number) => origin + v * step

    ctx.clearRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = 'rgba(0,212,255,0.08)'
    ctx.lineWidth = 1
    for (let i = -range; i <= range; i++) {
      const x = toCanvas(i, cx)
      const y = toCanvas(i, cy)
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }

    // Axes
    ctx.strokeStyle = 'rgba(0,212,255,0.35)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()

    // Axis tick labels
    ctx.fillStyle = 'rgba(0,212,255,0.4)'
    ctx.font = `${Math.max(9, step * 0.7)}px "Share Tech Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = -range; i <= range; i++) {
      if (i === 0) continue
      if (i % (range > 5 ? 2 : 1) !== 0) continue
      ctx.fillText(String(i), toCanvas(i, cx), cy + 3)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(-i), cx - 4, toCanvas(i, cy))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
    }

    // Arrow heads on axes
    const arrowSize = 6
    ctx.fillStyle = 'rgba(0,212,255,0.35)'
    ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx - arrowSize / 2, 4 + arrowSize); ctx.lineTo(cx + arrowSize / 2, 4 + arrowSize); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(W - 4, cy); ctx.lineTo(W - 4 - arrowSize, cy - arrowSize / 2); ctx.lineTo(W - 4 - arrowSize, cy + arrowSize / 2); ctx.closePath(); ctx.fill()

    // Axis labels
    ctx.fillStyle = 'rgba(0,212,255,0.5)'
    ctx.font = `bold ${step}px "Exo 2", sans-serif`
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText('x', W - step * 0.8, cy + 5)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText('y', cx + 6, 6)

    // Marked point
    const px = toCanvas(point.x, cx)
    const py = toCanvas(-point.y, cy)   // flip y: positive y is up

    const dotColor =
      feedback === null ? '#00d4ff' :
      feedback === true ? '#00ff9f' :
      '#ff3b5c'

    // Crosshair
    ctx.strokeStyle = `${dotColor}44`
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, py); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, py); ctx.lineTo(px, py); ctx.stroke()
    ctx.setLineDash([])

    // Glow ring
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, step * 0.9)
    gradient.addColorStop(0, `${dotColor}55`)
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.arc(px, py, step * 0.9, 0, Math.PI * 2); ctx.fill()

    // Dot
    ctx.fillStyle = dotColor
    ctx.shadowColor = dotColor
    ctx.shadowBlur = 12
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0

  }, [point, range, feedback, selected])

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={320}
      className="rounded-lg border border-[#0e2040]"
      style={{ background: '#080f1e' }}
      aria-label={`Grid showing marked point`}
    />
  )
}

// ─── Module ─────────────────────────────────────────────────────────────────

export function CoordinateSystem() {
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
  const startTimeRef = useRef(Date.now())

  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))
  const current = questions[qIdx]

  const advance = useCallback(() => {
    setQIdx((i) => i + 1)
    setSelected(null)
    setFeedback(null)
    startTimeRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (selected !== null) return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setTimeout(() => {
      if (qIdx + 1 >= QUESTIONS) setDone(true)
      else advance()
    }, 1400)
  }, [selected, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  useEffect(() => {
    reset(TIME_MS)
    startTimeRef.current = Date.now()
    const t = setTimeout(() => start(), 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  const handleSelect = useCallback((idx: number) => {
    if (selected !== null) return
    reset()
    const elapsed = Date.now() - startTimeRef.current
    const correct = idx === current.correctIndex
    setSelected(idx)
    setFeedback(correct)
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])
    setTimeout(() => {
      if (qIdx + 1 >= QUESTIONS) setDone(true)
      else advance()
    }, 1400)
  }, [selected, current, qIdx, advance, reset])

  useKeyPress('1', () => handleSelect(0), [handleSelect])
  useKeyPress('2', () => handleSelect(1), [handleSelect])
  useKeyPress('3', () => handleSelect(2), [handleSelect])
  useKeyPress('4', () => handleSelect(3), [handleSelect])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
    recordResult({ moduleId: MODULE.id, score: correct, total: QUESTIONS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setQIdx(0); setSelected(null); setFeedback(null)
    setScores([]); setTimes([]); setDone(false)
    setRetryKey((k) => k + 1)
  }

  if (done) {
    const correct = scores.filter(Boolean).length
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
    return (
      <div className="min-h-screen radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen module={MODULE} score={correct} total={QUESTIONS} avgTimeMs={avg}
          personalBest={storedScore?.highScore ?? 0} onRetry={handleRetry} />
      </div>
    )
  }

  const { point, options, correctIndex, range } = current

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col gap-6">

        {/* Prompt */}
        <AnimatePresence mode="wait">
          <motion.div key={qIdx} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="text-center">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">TASK</div>
            <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
              What are the <span className="text-[#00d4ff]">(x, y)</span> coordinates of the marked point?
            </h2>
            <div className="font-mono text-xs text-[#3a5068] mt-1">
              Grid range: ±{range} &nbsp;·&nbsp; Keys 1–4 or click
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Grid + Options */}
        <div className="flex flex-col sm:flex-row gap-6 items-center justify-center">
          {/* Canvas grid */}
          <motion.div
            key={`grid-${qIdx}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <GridCanvas question={current} feedback={feedback} selected={selected} />
            {/* Coordinate readout below canvas */}
            <div className="mt-2 text-center font-mono text-sm text-[#3a5068]">
              {feedback !== null
                ? <span style={{ color: feedback ? '#00ff9f' : '#ff3b5c' }}>
                    ({point.x}, {point.y})
                  </span>
                : <span>( ? , ? )</span>
              }
            </div>
          </motion.div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
            {options.map((opt, idx) => {
              const isSelected = selected === idx
              const isCorrect = idx === correctIndex
              let borderColor = '#0e2040'
              let bgColor = '#0a1628'
              let textColor = '#c8dff0'

              if (feedback !== null) {
                if (isCorrect) { borderColor = '#00ff9f'; bgColor = '#001a0f'; textColor = '#00ff9f' }
                else if (isSelected) { borderColor = '#ff3b5c'; bgColor = '#1a0008'; textColor = '#ff3b5c' }
              }

              return (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  onClick={() => handleSelect(idx)}
                  disabled={selected !== null}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/40"
                  style={{ borderColor, backgroundColor: bgColor }}
                  onMouseEnter={(e) => {
                    if (selected === null) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = '#00d4ff'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(0,212,255,0.2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selected === null) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = '#0e2040'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = ''
                    }
                  }}
                  aria-label={`Option ${idx + 1}: (${opt.x}, ${opt.y})`}
                >
                  <span className="w-6 h-6 rounded border border-[#0e2040] flex items-center justify-center font-mono text-xs text-[#3a5068] shrink-0">
                    {idx + 1}
                  </span>
                  <span className="font-mono text-lg" style={{ color: textColor }}>
                    ({opt.x}, {opt.y})
                  </span>
                  {feedback !== null && (
                    <span className="ml-auto font-mono text-base">
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
              ? `The correct coordinates were (${point.x}, ${point.y}).`
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
