import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ResultsScreen } from '../components/ResultsScreen'
import { ProgressBar } from '../components/ProgressBar'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 4)!
const ROUNDS = 8
const STREAM_INTERVAL = 800     // ms between stream updates
const IDLE_MIN = 1200           // min ms before outlier appears
const IDLE_MAX = 3000           // max ms before outlier appears
const OUTLIER_WINDOW = 2500     // ms user has to click after outlier appears
const HISTORY = 6               // visible rows per stream

const STREAMS = [
  { label: 'ALPHA', base: 248, unit: 'kt' },
  { label: 'BRAVO', base: 183, unit: 'kt' },
  { label: 'CHARLIE', base: 321, unit: 'kt' },
]

type Phase = 'idle' | 'outlier' | 'feedback' | 'done'

interface RoundResult {
  correct: boolean
  reactionMs: number
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function normalValue(base: number) {
  return base + randInt(-28, 28)
}

function outlierValue(base: number) {
  const delta = randInt(85, 130)
  return base + (Math.random() < 0.5 ? delta : -delta)
}

// ─── Stream Column ────────────────────────────────────────────────────────────

interface StreamColumnProps {
  label: string
  unit: string
  values: number[]
  isOutlier: boolean
  phase: Phase
  onClick: () => void
  feedbackCorrect: boolean | null   // null = no feedback yet for this col
  isWrongClick: boolean
}

function StreamColumn({
  label, unit, values, isOutlier, phase, onClick, feedbackCorrect, isWrongClick,
}: StreamColumnProps) {
  const canClick = phase === 'idle' || phase === 'outlier'

  let borderColor = '#0e2040'
  let headerColor = '#3a5068'
  if (phase === 'feedback') {
    if (feedbackCorrect === true) borderColor = '#00ff9f'
    else if (feedbackCorrect === false || isWrongClick) borderColor = '#ff3b5c'
  } else if (isOutlier && phase === 'outlier') {
    borderColor = '#ff3b5c'
  }

  return (
    <motion.button
      onClick={onClick}
      disabled={!canClick}
      className="flex-1 flex flex-col rounded-lg border transition-all duration-150 overflow-hidden focus:outline-none disabled:cursor-default cursor-pointer"
      style={{ borderColor, backgroundColor: '#080f1e' }}
      whileTap={canClick ? { scale: 0.97 } : {}}
      aria-label={`Stream ${label}`}
    >
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-[#0e2040] flex items-center justify-between"
        style={{ borderColor }}
      >
        <span className="font-mono text-xs tracking-widest" style={{ color: headerColor }}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-[#3a5068]">{unit}</span>
      </div>

      {/* Value list */}
      <div className="flex flex-col-reverse gap-px px-3 py-2 flex-1">
        {[...values].reverse().map((v, i) => {
          const isNewest = i === values.length - 1
          const isThisOutlier = isNewest && isOutlier
          return (
            <div
              key={i}
              className="font-mono text-right transition-colors duration-100"
              style={{
                fontSize: isNewest ? '1.5rem' : i === values.length - 2 ? '1rem' : '0.75rem',
                opacity: isNewest ? 1 : Math.max(0.2, (i + 1) / values.length),
                color: isThisOutlier
                  ? '#ff3b5c'
                  : isNewest
                  ? '#00d4ff'
                  : '#3a5068',
                fontWeight: isNewest ? 'bold' : 'normal',
                textShadow: isThisOutlier
                  ? '0 0 12px rgba(255,59,92,0.8)'
                  : isNewest
                  ? '0 0 8px rgba(0,212,255,0.5)'
                  : 'none',
              }}
            >
              {v}
            </div>
          )
        })}
      </div>

      {/* Outlier alert flash */}
      <AnimatePresence>
        {isOutlier && phase === 'outlier' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="px-3 py-1.5 font-mono text-[10px] tracking-widest text-center"
            style={{ color: '#ff3b5c', background: 'rgba(255,59,92,0.08)' }}
          >
            ⚠ OUTLIER
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback result */}
      {phase === 'feedback' && feedbackCorrect !== null && (
        <div
          className="px-3 py-1.5 font-mono text-[10px] tracking-widest text-center"
          style={{ color: feedbackCorrect ? '#00ff9f' : '#ff3b5c' }}
        >
          {feedbackCorrect ? '✓ CORRECT' : '✗ WRONG'}
        </div>
      )}
    </motion.button>
  )
}

// ─── Module ───────────────────────────────────────────────────────────────────

export function DividedAttention() {
  const navigate = useNavigate()
  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))

  // Stream values: array of HISTORY values, newest at index 0
  const [streamValues, setStreamValues] = useState<number[][]>(() =>
    STREAMS.map(({ base }) => Array.from({ length: HISTORY }, () => normalValue(base)))
  )

  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState(0)
  const [outlierStream, setOutlierStream] = useState(-1)
  const [results, setResults] = useState<RoundResult[]>([])
  const [wrongClick, setWrongClick] = useState(-1)     // stream index that was wrong-clicked
  const [correctStream, setCorrectStream] = useState(-1) // revealed on feedback
  const [retryKey, setRetryKey] = useState(0)
  const [done, setDone] = useState(false)

  const phaseRef = useRef(phase)
  const outlierStreamRef = useRef(outlierStream)
  const outlierTimeRef = useRef(0)
  const roundRef = useRef(round)
  const resultsRef = useRef(results)

  phaseRef.current = phase
  outlierStreamRef.current = outlierStream
  roundRef.current = round
  resultsRef.current = results

  // Advance to feedback then next round
  const toFeedback = useCallback((correct: boolean, reactionMs: number, outlierIdx: number) => {
    setPhase('feedback')
    setCorrectStream(outlierIdx)
    const newResults = [...resultsRef.current, { correct, reactionMs }]
    setResults(newResults)

    setTimeout(() => {
      const nextRound = roundRef.current + 1
      if (nextRound >= ROUNDS) {
        // Record before showing done
        const correctCount = newResults.filter((r) => r.correct).length
        const avgTime = newResults.filter((r) => r.correct).reduce((a, r) => a + r.reactionMs, 0) /
          Math.max(1, newResults.filter((r) => r.correct).length)
        recordResult({
          moduleId: MODULE.id,
          score: correctCount,
          total: ROUNDS,
          avgTimeMs: avgTime,
          completedAt: Date.now(),
        })
        setDone(true)
      } else {
        setRound(nextRound)
        setOutlierStream(-1)
        setWrongClick(-1)
        setCorrectStream(-1)
        setPhase('idle')
      }
    }, 1800)
  }, [recordResult])

  // Stream update interval
  useEffect(() => {
    const id = setInterval(() => {
      if (phaseRef.current === 'feedback' || phaseRef.current === 'done') return
      setStreamValues((prev) =>
        prev.map((vals, si) => {
          const base = STREAMS[si].base
          const newVal = si === outlierStreamRef.current
            ? vals[0] // keep outlier value while it's active
            : normalValue(base)
          return [newVal, ...vals.slice(0, HISTORY - 1)]
        })
      )
    }, STREAM_INTERVAL)
    return () => clearInterval(id)
  }, [retryKey])

  // Idle → inject outlier after random delay
  useEffect(() => {
    if (phase !== 'idle') return
    const delay = randInt(IDLE_MIN, IDLE_MAX)
    const t = setTimeout(() => {
      if (phaseRef.current !== 'idle') return
      const which = randInt(0, 2)
      const oVal = outlierValue(STREAMS[which].base)
      setStreamValues((prev) =>
        prev.map((vals, si) =>
          si === which ? [oVal, ...vals.slice(0, HISTORY - 1)] : vals
        )
      )
      setOutlierStream(which)
      setPhase('outlier')
      outlierTimeRef.current = Date.now()
    }, delay)
    return () => clearTimeout(t)
  }, [phase, round, retryKey])

  // Outlier timeout: miss if not clicked in time
  useEffect(() => {
    if (phase !== 'outlier') return
    const t = setTimeout(() => {
      if (phaseRef.current !== 'outlier') return
      toFeedback(false, OUTLIER_WINDOW, outlierStreamRef.current)
    }, OUTLIER_WINDOW)
    return () => clearTimeout(t)
  }, [phase, toFeedback])

  const handleStreamClick = useCallback((streamIdx: number) => {
    const p = phaseRef.current
    if (p === 'feedback' || p === 'done') return

    if (p === 'idle') {
      // False positive — clicked when no outlier present
      setWrongClick(streamIdx)
      toFeedback(false, 0, -1)
      return
    }

    // p === 'outlier'
    const reaction = Date.now() - outlierTimeRef.current
    if (streamIdx === outlierStreamRef.current) {
      toFeedback(true, reaction, streamIdx)
    } else {
      setWrongClick(streamIdx)
      toFeedback(false, reaction, outlierStreamRef.current)
    }
  }, [toFeedback])

  const handleRetry = () => {
    setStreamValues(STREAMS.map(({ base }) =>
      Array.from({ length: HISTORY }, () => normalValue(base))
    ))
    setPhase('idle')
    setRound(0)
    setOutlierStream(-1)
    setResults([])
    setWrongClick(-1)
    setCorrectStream(-1)
    setDone(false)
    setRetryKey((k) => k + 1)
  }

  if (done) {
    const correctCount = results.filter((r) => r.correct).length
    const avgTime = results.filter((r) => r.correct && r.reactionMs > 0)
      .reduce((a, r) => a + r.reactionMs, 0) /
      Math.max(1, results.filter((r) => r.correct && r.reactionMs > 0).length)
    return (
      <div className="min-h-screen radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen
          module={MODULE}
          score={correctCount}
          total={ROUNDS}
          avgTimeMs={avgTime}
          personalBest={storedScore?.highScore ?? 0}
          onRetry={handleRetry}
        />
      </div>
    )
  }

  const correctCount = results.filter((r) => r.correct).length

  return (
    <div className="min-h-screen flex flex-col radar-grid">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040] bg-[#050d1a]/80">
        <button
          onClick={() => navigate('/')}
          className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors"
        >
          ← HOME
        </button>
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">{MODULE.stage}</div>
          <div className="font-ui text-sm font-medium text-[#c8dff0]">{MODULE.name}</div>
        </div>
        <div className="font-mono text-xs text-[#3a5068]">
          {correctCount}/{round} ✓
        </div>
      </header>

      {/* Progress */}
      <div className="px-6 py-3 border-b border-[#0e2040]">
        <ProgressBar current={round} total={ROUNDS} />
      </div>

      <main className="flex-1 flex flex-col px-4 py-6 gap-6 max-w-3xl mx-auto w-full">
        {/* Instructions */}
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">
            ROUND {round + 1} OF {ROUNDS}
          </div>
          <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
            Click the stream showing an{' '}
            <span className="text-[#ff3b5c]">outlier value</span>
          </h2>
          <p className="font-mono text-xs text-[#3a5068] mt-1">
            Monitor all three streams — react immediately when one spikes
          </p>
        </div>

        {/* Phase indicator */}
        <div className="flex justify-center">
          <div
            className={`px-4 py-1.5 rounded border font-mono text-xs tracking-widest transition-all duration-200 ${
              phase === 'outlier'
                ? 'border-[#ff3b5c] text-[#ff3b5c] bg-[#ff3b5c]/10 animate-pulse'
                : phase === 'feedback'
                ? 'border-[#3a5068] text-[#3a5068]'
                : 'border-[#00d4ff]/30 text-[#00d4ff]/60'
            }`}
          >
            {phase === 'idle' && '● MONITORING — WAIT FOR OUTLIER'}
            {phase === 'outlier' && '⚠ OUTLIER DETECTED — CLICK NOW'}
            {phase === 'feedback' && (
              results[results.length - 1]?.correct ? '✓ CORRECT' : '✗ MISSED'
            )}
          </div>
        </div>

        {/* Three streams */}
        <div className="flex gap-3 flex-1" style={{ minHeight: 280 }}>
          {STREAMS.map((s, si) => {
            const isThisOutlier = outlierStream === si
            return (
              <StreamColumn
                key={s.label}
                label={s.label}
                unit={s.unit}
                values={streamValues[si]}
                isOutlier={isThisOutlier}
                phase={phase}
                onClick={() => handleStreamClick(si)}
                feedbackCorrect={
                  phase === 'feedback'
                    ? si === correctStream
                      ? true
                      : si === wrongClick
                      ? false
                      : null
                    : null
                }
                isWrongClick={wrongClick === si}
              />
            )
          })}
        </div>

        {/* Round history dots */}
        <div className="flex justify-center gap-2">
          {Array.from({ length: ROUNDS }).map((_, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full transition-colors duration-300"
              style={{
                backgroundColor:
                  i < results.length
                    ? results[i].correct ? '#00ff9f' : '#ff3b5c'
                    : i === round
                    ? '#00d4ff'
                    : '#0e2040',
              }}
            />
          ))}
        </div>

        <p className="font-mono text-[10px] text-[#3a5068] text-center">
          Unofficial practice tool — not affiliated with EUROCONTROL, SkyTest, or Nav Canada
        </p>
      </main>
    </div>
  )
}
