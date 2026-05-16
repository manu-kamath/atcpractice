import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 7)!
const QUESTIONS = 8
const TIME_MS = 12000

// ─── Shape geometry ───────────────────────────────────────────────────────────

interface Pt { x: number; y: number }
type Shape = Pt[]

/** Tiny xorshift RNG seeded by an integer */
function makeRng(seed: number) {
  let s = (Math.abs(seed) + 1) * 2654435761 >>> 0
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5
    return (s >>> 0) / 4294967295
  }
}

/**
 * Generate an irregular polygon with `n` vertices.
 * Vertex 0 is always a pronounced spike so rotation direction is clear.
 * All other vertices have shorter, varied radii creating clear asymmetry.
 */
function generateShape(n: number, seed: number): Shape {
  const rng = makeRng(seed)
  const pts: Pt[] = []
  const step = (Math.PI * 2) / n

  for (let i = 0; i < n; i++) {
    // Irregular angle: perturb by up to 35% of the step
    const angle = i * step + (rng() - 0.5) * step * 0.7
    // Vertex 0 = spike (0.78–0.95), vertex 1 = notch (0.22–0.35), rest varied
    const r = i === 0
      ? 0.78 + rng() * 0.17
      : i === 1
      ? 0.22 + rng() * 0.13
      : 0.38 + rng() * 0.38
    pts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
  }
  return pts
}

function rotate(shape: Shape, angle: number): Shape {
  const c = Math.cos(angle), s = Math.sin(angle)
  return shape.map(({ x, y }) => ({ x: x * c - y * s, y: x * s + y * c }))
}

/** Horizontal mirror — cannot be achieved by any rotation of an asymmetric shape */
function mirror(shape: Shape): Shape {
  return shape.map(({ x, y }) => ({ x: -x, y }))
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawShapeOnCtx(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string,
  fillAlpha = 0.12,
  lineWidth = 2
) {
  ctx.beginPath()
  ctx.moveTo(cx + shape[0].x * size, cy + shape[0].y * size)
  for (let i = 1; i < shape.length; i++) {
    ctx.lineTo(cx + shape[i].x * size, cy + shape[i].y * size)
  }
  ctx.closePath()

  // Fill
  const [r, g, b] = strokeColor === '#00ff9f' ? [0, 255, 159]
    : strokeColor === '#ff3b5c' ? [255, 59, 92]
    : [0, 212, 255]
  ctx.fillStyle = `rgba(${r},${g},${b},${fillAlpha})`
  ctx.fill()

  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.stroke()
}

function renderCanvas(
  canvas: HTMLCanvasElement,
  shape: Shape,
  strokeColor: string,
  size: number,
  bg = '#080f1e'
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  drawShapeOnCtx(ctx, shape, W / 2, H / 2, size, strokeColor)
}

// ─── Canvas components ────────────────────────────────────────────────────────

function RefCanvas({ shape }: { shape: Shape }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) renderCanvas(ref.current, shape, '#00d4ff', 80, '#060e1c') }, [shape])
  return (
    <canvas ref={ref} width={200} height={200}
      className="rounded-lg border border-[#0e2040]"
      aria-label="Reference shape" />
  )
}

function OptionCanvas({ shape, color }: { shape: Shape; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) renderCanvas(ref.current, shape, color, 52) }, [shape, color])
  return <canvas ref={ref} width={130} height={130} aria-hidden />
}

// ─── Question generation ──────────────────────────────────────────────────────

interface Question {
  base: Shape           // reference shape (what's shown on left)
  shapes: Shape[]       // 4 shuffled option shapes
  correctIndex: number
}

function generateQuestion(qIdx: number): Question {
  const nVerts = qIdx < 3 ? 5 : qIdx < 6 ? 6 : 7
  const baseSeed = qIdx * 173 + 31
  const base = generateShape(nVerts, baseSeed)

  // Correct answer: rotate base by a meaningful angle
  // Easy questions: 90° / 180° / 270° step. Hard: any angle.
  const easyAngles = [Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const rotAngle = qIdx < 3
    ? easyAngles[qIdx % 3]
    : (Math.PI * 0.25) + Math.random() * (Math.PI * 1.5)

  const correct = rotate(base, rotAngle)
  const wrong1 = mirror(correct)                           // mirror of the rotated version
  const wrong2 = generateShape(nVerts, baseSeed + 500)    // different shape, same vertex count
  const wrong3 = generateShape(nVerts, baseSeed + 1200)   // another different shape

  const all = [correct, wrong1, wrong2, wrong3]
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5)
  const shapes = order.map((i) => all[i])
  const correctIndex = order.indexOf(0)

  return { base, shapes, correctIndex }
}

// ─── Module ───────────────────────────────────────────────────────────────────

export function MatchingFigure() {
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

  const nVerts = qIdx < 3 ? 5 : qIdx < 6 ? 6 : 7

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col gap-6">

        {/* Prompt */}
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">TASK</div>
          <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
            Which option is the <span className="text-[#00d4ff]">same shape</span> — rotated, not mirrored?
          </h2>
          <p className="font-mono text-xs text-[#3a5068] mt-1">
            {nVerts}-vertex shape · Keys 1–4 or click
          </p>
        </div>

        {/* Reference + Options */}
        <div className="flex flex-col sm:flex-row gap-6 items-center justify-center">

          {/* Reference shape */}
          <AnimatePresence mode="wait">
            <motion.div key={qIdx} initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2">
              <span className="font-mono text-[10px] text-[#3a5068] tracking-widest">REFERENCE</span>
              <RefCanvas shape={q.base} />
            </motion.div>
          </AnimatePresence>

          {/* Options grid */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] text-[#3a5068] tracking-widest">OPTIONS</span>
            <div className="grid grid-cols-2 gap-2">
              {q.shapes.map((shape, idx) => {
                const isSelected = selected === idx
                const isCorrect = idx === q.correctIndex
                let borderColor = '#0e2040'
                let shapeColor = '#00d4ff'

                if (feedback !== null) {
                  if (isCorrect) { borderColor = '#00ff9f'; shapeColor = '#00ff9f' }
                  else if (isSelected) { borderColor = '#ff3b5c'; shapeColor = '#ff3b5c' }
                  else { shapeColor = 'rgba(0,212,255,0.3)' }
                }

                return (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.07 }}
                    onClick={() => handleSelect(idx)}
                    disabled={selected !== null}
                    className="relative flex flex-col items-center rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none overflow-hidden"
                    style={{ borderColor, backgroundColor: '#0a1628' }}
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
                    aria-label={`Option ${idx + 1}`}
                  >
                    {/* Key label */}
                    <div className="absolute top-1.5 left-2 font-mono text-[10px] text-[#3a5068]">
                      {idx + 1}
                    </div>
                    <OptionCanvas shape={shape} color={shapeColor} />
                    {/* Feedback badge */}
                    {feedback !== null && (isCorrect || isSelected) && (
                      <div
                        className="absolute bottom-1 right-2 font-mono text-xs font-bold"
                        style={{ color: isCorrect ? '#00ff9f' : '#ff3b5c' }}
                      >
                        {isCorrect ? '✓' : '✗'}
                      </div>
                    )}
                  </motion.button>
                )
              })}
            </div>
          </div>
        </div>

        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? 'Tip: trace the longest vertex (spike) and note how the shorter vertices are arranged around it. Only rotation preserves that winding order — mirrors reverse it.'
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
