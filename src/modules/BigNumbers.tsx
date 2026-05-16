import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 1)!
const QUESTIONS = 8
const TIME_MS = 8000

type Task = 'largest' | 'smallest'

interface Question {
  numbers: number[]
  task: Task
  correctIndex: number
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function makeNumber(digits: number) {
  const min = Math.pow(10, digits - 1)
  const max = Math.pow(10, digits) - 1
  return randInt(min, max)
}

function formatNum(n: number) {
  return n.toLocaleString('en-CA')
}

function generateQuestion(): Question {
  const digits = randInt(7, 9)
  let numbers: number[] = []

  // Generate 4 distinct numbers in a tight-ish range to make it non-trivial
  while (numbers.length < 4) {
    const n = makeNumber(digits)
    if (!numbers.includes(n)) numbers.push(n)
  }

  const task: Task = Math.random() < 0.5 ? 'largest' : 'smallest'
  const target = task === 'largest' ? Math.max(...numbers) : Math.min(...numbers)
  const correctIndex = numbers.indexOf(target)

  return { numbers, task, correctIndex }
}

export function BigNumbers() {
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
    setQIdx((i) => {
      const next = i + 1
      if (next >= QUESTIONS) return i
      return next
    })
    setSelected(null)
    setFeedback(null)
    startTimeRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (selected !== null) return
    const elapsed = Date.now() - startTimeRef.current
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, false])
    setFeedback(false)
    setTimeout(() => {
      if (qIdx + 1 >= QUESTIONS) {
        setDone(true)
      } else {
        advance()
      }
    }, 1200)
  }, [selected, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  // Start timer on mount / question change
  useEffect(() => {
    reset(TIME_MS)
    startTimeRef.current = Date.now()
    const t = setTimeout(() => start(), 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  const handleSelect = useCallback((idx: number) => {
    if (selected !== null || feedback !== null) return
    reset()
    const elapsed = Date.now() - startTimeRef.current
    const correct = idx === current.correctIndex
    setSelected(idx)
    setFeedback(correct)
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])

    setTimeout(() => {
      if (qIdx + 1 >= QUESTIONS) {
        setDone(true)
      } else {
        advance()
      }
    }, 1200)
  }, [selected, feedback, current, qIdx, advance, reset])

  // Keyboard: 1-4 to pick option
  useKeyPress('1', () => handleSelect(0), [handleSelect])
  useKeyPress('2', () => handleSelect(1), [handleSelect])
  useKeyPress('3', () => handleSelect(2), [handleSelect])
  useKeyPress('4', () => handleSelect(3), [handleSelect])

  // Record result when done
  useEffect(() => {
    if (!done) return
    const correctCount = scores.filter(Boolean).length
    const avgTime = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
    recordResult({
      moduleId: MODULE.id,
      score: correctCount,
      total: QUESTIONS,
      avgTimeMs: avgTime,
      completedAt: Date.now(),
    })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setQIdx(0)
    setSelected(null)
    setFeedback(null)
    setScores([])
    setTimes([])
    setDone(false)
    setRetryKey((k) => k + 1)
  }

  if (done) {
    const correctCount = scores.filter(Boolean).length
    const avgTime = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
    return (
      <div className="min-h-screen radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen
          module={MODULE}
          score={correctCount}
          total={QUESTIONS}
          avgTimeMs={avgTime}
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
      total={QUESTIONS}
      timerPct={pct}
      timerRemaining={remaining}
    >
      <div className="flex flex-col gap-8">
        {/* Task prompt */}
        <AnimatePresence mode="wait">
          <motion.div
            key={qIdx}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-center"
          >
            <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-2">TASK</div>
            <h2 className="font-ui text-2xl font-semibold text-[#c8dff0]">
              Select the{' '}
              <span
                className="font-bold"
                style={{ color: current.task === 'largest' ? '#00d4ff' : '#00ff9f' }}
              >
                {current.task === 'largest' ? 'LARGEST' : 'SMALLEST'}
              </span>{' '}
              number
            </h2>
            <div className="font-mono text-xs text-[#3a5068] mt-1">
              Keys 1–4 or click to select
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Number options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {current.numbers.map((num, idx) => {
            const isSelected = selected === idx
            const isCorrect = idx === current.correctIndex
            let borderColor = '#0e2040'
            let bgColor = '#0a1628'
            let textColor = '#c8dff0'

            if (feedback !== null) {
              if (isCorrect) {
                borderColor = '#00ff9f'
                bgColor = '#001a0f'
                textColor = '#00ff9f'
              } else if (isSelected && !isCorrect) {
                borderColor = '#ff3b5c'
                bgColor = '#1a0008'
                textColor = '#ff3b5c'
              }
            }

            return (
              <motion.button
                key={idx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.06 }}
                onClick={() => handleSelect(idx)}
                disabled={selected !== null}
                className="relative flex items-center gap-4 px-5 py-4 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/40"
                style={{ borderColor, backgroundColor: bgColor }}
                onMouseEnter={(e) => {
                  if (selected === null) {
                    ;(e.currentTarget as HTMLElement).style.borderColor = '#00d4ff'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(0,212,255,0.2)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (selected === null) {
                    ;(e.currentTarget as HTMLElement).style.borderColor = '#0e2040'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = ''
                  }
                }}
                aria-label={`Option ${idx + 1}: ${formatNum(num)}`}
              >
                {/* Key hint */}
                <div
                  className="w-7 h-7 rounded border flex items-center justify-center font-mono text-xs shrink-0"
                  style={{ borderColor: '#0e2040', color: '#3a5068' }}
                >
                  {idx + 1}
                </div>

                {/* Number */}
                <span
                  className="font-mono text-2xl tracking-wider transition-colors"
                  style={{ color: textColor }}
                >
                  {formatNum(num)}
                </span>

                {/* Feedback icon */}
                {feedback !== null && (
                  <span className="ml-auto font-mono text-lg">
                    {isCorrect ? '✓' : isSelected ? '✗' : ''}
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>

        {/* Feedback */}
        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? `The ${current.task} was ${formatNum(current.numbers[current.correctIndex])}.`
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
