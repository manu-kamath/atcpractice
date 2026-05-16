import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 11)!
const ROUNDS = 8
const TIME_MS = 15_000

const WAYPOINT_POOL = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO',
  'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET',
]

// ─── Constraints ──────────────────────────────────────────────────────────────

type Constraint =
  | { type: 'first'; waypoint: string }
  | { type: 'last'; waypoint: string }
  | { type: 'before'; a: string; b: string }
  | { type: 'immediate'; a: string; b: string }

function constraintText(c: Constraint): string {
  switch (c.type) {
    case 'first':     return `${c.waypoint} must be first`
    case 'last':      return `${c.waypoint} must be last`
    case 'before':    return `${c.a} before ${c.b}`
    case 'immediate': return `${c.a} immediately before ${c.b}`
  }
}

function satisfies(seq: string[], c: Constraint): boolean {
  switch (c.type) {
    case 'first':     return seq[0] === c.waypoint
    case 'last':      return seq[seq.length - 1] === c.waypoint
    case 'before':    return seq.indexOf(c.a) < seq.indexOf(c.b)
    case 'immediate': {
      const i = seq.indexOf(c.a)
      return i >= 0 && seq[i + 1] === c.b
    }
  }
}

function satisfiesAll(seq: string[], constraints: Constraint[]): boolean {
  return constraints.every((c) => satisfies(seq, c))
}

// ─── Question generation ──────────────────────────────────────────────────────

interface Question {
  constraints: Constraint[]
  options: string[][]
  correctIndex: number
  explanation: string
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateWrong(valid: string[], constraints: Constraint[], exclude = ''): string[] {
  for (let i = 0; i < 400; i++) {
    const candidate = shuffle(valid)
    const key = candidate.join()
    if (key !== valid.join() && key !== exclude && !satisfiesAll(candidate, constraints)) {
      return candidate
    }
  }
  // Fallback: explicitly violate the first constraint
  const c = constraints[0]
  const seq = [...valid]
  if (c.type === 'first') {
    const first = seq.shift()!
    seq.splice(randInt(1, seq.length - 1), 0, first)
    return seq
  }
  if (c.type === 'last') {
    const last = seq.pop()!
    seq.splice(randInt(0, seq.length - 1), 0, last)
    return seq
  }
  if (c.type === 'before') {
    const ia = seq.indexOf(c.a)
    const ib = seq.indexOf(c.b)
    ;[seq[ia], seq[ib]] = [seq[ib], seq[ia]]
    return seq
  }
  // immediate: move 'a' to a non-adjacent position relative to 'b'
  const ia = seq.indexOf(c.a)
  const removed = seq.splice(ia, 1)[0]
  const ib = seq.indexOf(c.b)
  const allowed = [...Array(seq.length + 1).keys()].filter((i) => i !== ib)
  seq.splice(allowed[randInt(0, allowed.length - 1)], 0, removed)
  return seq
}

function generateQuestion(qIndex: number): Question {
  const count = qIndex < 4 ? 5 : 6
  const names = shuffle([...WAYPOINT_POOL]).slice(0, count)
  const valid = shuffle([...names])

  const constraints: Constraint[] = []

  // One positional constraint (first or last)
  if (Math.random() < 0.5) {
    constraints.push({ type: 'first', waypoint: valid[0] })
  } else {
    constraints.push({ type: 'last', waypoint: valid[valid.length - 1] })
  }

  // 1–2 ordering constraints derived from the valid sequence
  const numExtra = randInt(1, 2)
  const pairs: [number, number][] = []
  for (let i = 0; i < valid.length - 1; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      pairs.push([i, j])
    }
  }
  const chosen = shuffle(pairs).slice(0, numExtra)
  for (const [i, j] of chosen) {
    const adjacent = j === i + 1
    if (adjacent && Math.random() < 0.4) {
      constraints.push({ type: 'immediate', a: valid[i], b: valid[j] })
    } else {
      constraints.push({ type: 'before', a: valid[i], b: valid[j] })
    }
  }

  const wrong1 = generateWrong(valid, constraints)
  const wrong2 = generateWrong(valid, constraints, wrong1.join())

  const options = shuffle([valid, wrong1, wrong2])
  const correctIndex = options.findIndex((o) => o.join() === valid.join())

  const violation = constraints[randInt(0, constraints.length - 1)]
  const explanation = `Only option satisfying: ${constraintText(violation)}`

  return { constraints, options, correctIndex, explanation }
}

function buildSession(): Question[] {
  return Array.from({ length: ROUNDS }, (_, i) => generateQuestion(i))
}

// ─── Waypoint chip ────────────────────────────────────────────────────────────

function WaypointChip({ label, highlight }: { label: string; highlight?: boolean }) {
  return (
    <span
      className="px-2 py-0.5 rounded font-mono text-xs border"
      style={{
        borderColor: highlight ? '#00d4ff' : '#0e2040',
        color: highlight ? '#00d4ff' : '#c8dff0',
        background: highlight ? '#00d4ff12' : '#080f1e',
      }}
    >
      {label}
    </span>
  )
}

// ─── Module ───────────────────────────────────────────────────────────────────

export function PlanningAbility() {
  const [questions] = useState<Question[]>(buildSession)
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
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
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
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [selected, q, qIdx, advance, reset])

  useKeyPress('1', () => handleSelect(0), [handleSelect])
  useKeyPress('2', () => handleSelect(1), [handleSelect])
  useKeyPress('3', () => handleSelect(2), [handleSelect])

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

  return (
    <ModuleShell
      module={MODULE}
      questionNum={qIdx + 1}
      total={ROUNDS}
      timerPct={pct}
      timerRemaining={remaining}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={qIdx}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-5"
        >
          {/* Constraints panel */}
          <div className="rounded-lg border border-[#0e2040] bg-[#080f1e] p-4 space-y-3">
            <div className="font-mono text-[10px] text-[#3a5068] tracking-widest">
              ORDERING CONSTRAINTS
            </div>
            <div className="flex flex-col gap-2">
              {q.constraints.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded border border-[#0e2040] bg-[#0a1628] px-3 py-2"
                >
                  <span className="font-mono text-xs text-[#3a5068] w-4 shrink-0">
                    {i + 1}.
                  </span>
                  <span className="font-mono text-sm text-[#c8dff0]">
                    {constraintText(c)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <div className="font-mono text-[10px] text-[#3a5068] tracking-widest">
              SELECT VALID SEQUENCE  (keys 1 – 3)
            </div>
            {q.options.map((seq, i) => {
              const isSelected = selected === i
              const isCorrect = i === q.correctIndex
              let border = 'border-[#0e2040]'
              let bg = 'bg-[#0a1628]'
              let labelColor = '#3a5068'

              if (selected !== null) {
                if (isCorrect) { border = 'border-[#00ff9f]'; bg = 'bg-[#001a0f]'; labelColor = '#00ff9f' }
                else if (isSelected) { border = 'border-[#ff3b5c]'; bg = 'bg-[#1a0008]'; labelColor = '#ff3b5c' }
              } else if (isSelected) {
                border = 'border-[#00d4ff]'
                bg = 'bg-[#00d4ff10]'
                labelColor = '#00d4ff'
              }

              return (
                <motion.button
                  key={i}
                  whileHover={selected === null ? { scale: 1.01 } : {}}
                  whileTap={selected === null ? { scale: 0.99 } : {}}
                  onClick={() => handleSelect(i)}
                  disabled={selected !== null}
                  className={`w-full rounded border ${border} ${bg} px-4 py-3 flex items-center gap-3 text-left transition-colors disabled:cursor-default`}
                >
                  <span
                    className="font-mono text-xs shrink-0 w-5"
                    style={{ color: labelColor }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {seq.map((wp, wi) => (
                      <span key={wi} className="flex items-center gap-1">
                        <WaypointChip
                          label={wp}
                          highlight={selected !== null && isCorrect}
                        />
                        {wi < seq.length - 1 && (
                          <span className="font-mono text-xs text-[#3a5068]">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                  {selected !== null && isCorrect && (
                    <span className="ml-auto font-mono text-xs text-[#00ff9f]">✓</span>
                  )}
                  {selected !== null && isSelected && !isCorrect && (
                    <span className="ml-auto font-mono text-xs text-[#ff3b5c]">✗</span>
                  )}
                </motion.button>
              )
            })}
          </div>

          {/* Feedback */}
          <FeedbackBanner
            correct={feedback}
            explanation={feedback === false ? q.explanation : ''}
          />
        </motion.div>
      </AnimatePresence>
    </ModuleShell>
  )
}
