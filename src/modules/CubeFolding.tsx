import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 3)!
const QUESTIONS = 8
const TIME_MS = 14000

// Cross-shaped net layout — face indices:
//       [0]
//  [1]  [2]  [3]  [4]
//       [5]
//
// Face roles: 0=TOP, 1=LEFT, 2=FRONT, 3=RIGHT, 4=BACK, 5=BOTTOM
// Opposite pairs: 0↔5, 1↔3, 2↔4
//
// Isometric view (top-right perspective):
//   visible top   = face 0
//   visible front = face 2 (drawn as left panel)
//   visible right = face 3 (drawn as right panel)

const PALETTE = [
  '#e74c3c', // red
  '#3498db', // blue
  '#f1c40f', // yellow
  '#2ecc71', // green
  '#9b59b6', // purple
  '#e67e22', // orange
]

const NET_LABELS = ['T', 'L', 'F', 'R', 'B', 'Bo']

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface CubeFace { top: string; front: string; right: string }

interface Question {
  colors: string[]       // colors[i] = color of face i
  options: CubeFace[]
  correctIndex: number
}

function generateQuestion(): Question {
  const colors = shuffle(PALETTE)

  const correct: CubeFace = { top: colors[0], front: colors[2], right: colors[3] }
  // Each wrong option swaps one visible face with its opposite (impossible combinations)
  const wrong1: CubeFace = { top: colors[5], front: colors[2], right: colors[3] } // bottom on top
  const wrong2: CubeFace = { top: colors[0], front: colors[4], right: colors[3] } // back as front
  const wrong3: CubeFace = { top: colors[0], front: colors[2], right: colors[1] } // left as right

  const options = shuffle([correct, wrong1, wrong2, wrong3])
  return { colors, options, correctIndex: options.indexOf(correct) }
}

// ─── Canvas drawing ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`
}

function drawNet(canvas: HTMLCanvasElement, colors: string[]) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const cell = Math.floor(Math.min(W / 5, H / 3.5))
  // Centre the 4×3 bounding box
  const ox = Math.floor((W - cell * 4) / 2)
  const oy = Math.floor((H - cell * 3) / 2)

  // Face positions: [col, row]
  const positions: [number, number][] = [
    [1, 0], // 0 TOP
    [0, 1], // 1 LEFT
    [1, 1], // 2 FRONT
    [2, 1], // 3 RIGHT
    [3, 1], // 4 BACK
    [1, 2], // 5 BOTTOM
  ]

  positions.forEach(([col, row], i) => {
    const x = ox + col * cell
    const y = oy + row * cell
    const pad = 3

    // Fill
    ctx.fillStyle = colors[i]
    ctx.beginPath()
    ctx.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, 5)
    ctx.fill()

    // Border
    ctx.strokeStyle = '#050d1a'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Label
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.font = `bold ${Math.round(cell * 0.28)}px "Exo 2", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(NET_LABELS[i], x + cell / 2, y + cell / 2)
  })

  // Draw fold lines (dashed)
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = 'rgba(0,212,255,0.25)'
  ctx.lineWidth = 1
  // Vertical folds between face 1-2, 2-3, 3-4
  for (let col = 1; col <= 3; col++) {
    const fx = ox + col * cell
    ctx.beginPath()
    ctx.moveTo(fx, oy + cell)
    ctx.lineTo(fx, oy + cell * 2)
    ctx.stroke()
  }
  // Horizontal folds top and bottom
  ctx.beginPath()
  ctx.moveTo(ox + cell, oy + cell)
  ctx.lineTo(ox + cell * 2, oy + cell)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ox + cell, oy + cell * 2)
  ctx.lineTo(ox + cell * 2, oy + cell * 2)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawIsoCube(
  canvas: HTMLCanvasElement,
  topColor: string,
  frontColor: string,
  rightColor: string,
  feedbackState: boolean | null
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const s = Math.round(Math.min(W, H) * 0.27)  // half-width of each iso face
  const dh = Math.round(s / 2)                  // vertical step (2:1 ratio)
  const cx = Math.round(W / 2)
  const cy = Math.round(H / 2 - s * 0.45)

  // 7 key vertices
  const A: [number, number] = [cx, cy]
  const B: [number, number] = [cx + s, cy + dh]
  const C: [number, number] = [cx - s, cy + dh]
  const D: [number, number] = [cx, cy + 2 * dh]
  const E: [number, number] = [cx + s, cy + 3 * dh]
  const F: [number, number] = [cx - s, cy + 3 * dh]
  const G: [number, number] = [cx, cy + 4 * dh]

  const drawFace = (pts: [number, number][], color: string, shadeFactor: number) => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
    ctx.fillStyle = shade(color, shadeFactor)
    ctx.fill()
    ctx.strokeStyle = '#050d1a'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Top (full brightness), right (slightly dark), front/left (medium)
  drawFace([A, B, D, C], topColor, 1.0)
  drawFace([B, E, G, D], rightColor, 0.72)
  drawFace([C, D, G, F], frontColor, 0.85)

  // Feedback highlight
  if (feedbackState !== null) {
    ctx.fillStyle = feedbackState
      ? 'rgba(0,255,159,0.18)'
      : 'rgba(255,59,92,0.18)'
    ctx.fillRect(0, 0, W, H)
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NetCanvas({ colors }: { colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawNet(ref.current, colors) }, [colors])
  return (
    <canvas
      ref={ref}
      width={300}
      height={180}
      className="rounded-lg border border-[#0e2040]"
      style={{ background: '#080f1e' }}
      aria-label="Cube net"
    />
  )
}

function CubeCanvas({ face, state }: { face: CubeFace; state: boolean | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawIsoCube(ref.current, face.top, face.front, face.right, state)
  }, [face, state])
  return <canvas ref={ref} width={120} height={120} aria-hidden />
}

// ─── Module ──────────────────────────────────────────────────────────────────

export function CubeFolding() {
  const [questions] = useState<Question[]>(() =>
    Array.from({ length: QUESTIONS }, generateQuestion)
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
    }, 1500)
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
    }, 1500)
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

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col gap-6">

        {/* Prompt */}
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">TASK</div>
          <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
            Which cube can be folded from this net?
          </h2>
          <p className="font-mono text-xs text-[#3a5068] mt-1">
            T=Top · F=Front · R=Right · L=Left · B=Back · Bo=Bottom
          </p>
        </div>

        {/* Net display */}
        <AnimatePresence mode="wait">
          <motion.div key={qIdx} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} className="flex flex-col items-center gap-1">
            <span className="font-mono text-[10px] text-[#3a5068] tracking-widest">FLAT NET</span>
            <NetCanvas colors={current.colors} />
          </motion.div>
        </AnimatePresence>

        {/* Cube options */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {current.options.map((face, idx) => {
            const isSelected = selected === idx
            const isCorrect = idx === current.correctIndex
            let borderColor = '#0e2040'
            let cubeState: boolean | null = null

            if (feedback !== null) {
              if (isCorrect) { borderColor = '#00ff9f'; cubeState = true }
              else if (isSelected) { borderColor = '#ff3b5c'; cubeState = false }
            }

            return (
              <motion.button
                key={idx}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.07 }}
                onClick={() => handleSelect(idx)}
                disabled={selected !== null}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none"
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
                <span className="font-mono text-xs text-[#3a5068]">{idx + 1}</span>
                <CubeCanvas face={face} state={cubeState} />
                {feedback !== null && (
                  <span className="font-mono text-sm" style={{ color: isCorrect ? '#00ff9f' : isSelected ? '#ff3b5c' : 'transparent' }}>
                    {isCorrect ? '✓ CORRECT' : isSelected ? '✗ WRONG' : '—'}
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>

        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? 'Tip: match the Top face first, then check which colours are adjacent to it in the net.'
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
