import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ResultsScreen } from '../components/ResultsScreen'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 10)!
const ROUNDS = 8
const ROUND_MS = 30_000
const TICK_MS = 100
const COUNTER_TICK_MS = 500
const COUNTER_HIDE_MS = 16_000
const SHAPE_APPEAR_MS = 9_000
const SHAPE_SHOW_MS = 2_500
const BLINK_DURATION_MS = 1_800

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon'] as const
type Shape = (typeof SHAPES)[number]
type BlinkState = 'waiting' | 'flashing' | 'hit' | 'missed'

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

interface RoundSetup {
  counterStart: number
  counterDir: 1 | -1
  counterAnswer: number
  counterChoices: number[]
  shape: Shape
  shapeChoices: Shape[]
  seqNums: number[]
  seqAnswer: number
  seqChoices: number[]
  blinkAt: number
}

function generateRound(): RoundSetup {
  const counterStart = randInt(100, 800)
  const counterDir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1
  const ticks = Math.floor(COUNTER_HIDE_MS / COUNTER_TICK_MS)
  const counterAnswer = counterStart + counterDir * ticks
  const counterChoices = shuffle([
    counterAnswer,
    counterAnswer + counterDir * 1,
    counterAnswer + counterDir * 3,
    counterAnswer - counterDir * 2,
  ])

  const shape = SHAPES[randInt(0, SHAPES.length - 1)]
  const shapeChoices = shuffle([
    shape,
    ...shuffle(SHAPES.filter((s) => s !== shape)).slice(0, 3),
  ]) as Shape[]

  const seqBase = randInt(2, 20)
  const seqStep = randInt(2, 9)
  const seqNums = [
    seqBase,
    seqBase + seqStep,
    seqBase + 2 * seqStep,
    seqBase + 3 * seqStep,
  ]
  const seqAnswer = seqBase + 4 * seqStep
  const seqChoices = shuffle([
    seqAnswer,
    seqAnswer + seqStep,
    seqAnswer - seqStep,
    seqAnswer + randInt(1, seqStep - 1 > 0 ? seqStep - 1 : 1),
  ])

  const blinkAt = randInt(5_000, 24_000)

  return {
    counterStart,
    counterDir,
    counterAnswer,
    counterChoices,
    shape,
    shapeChoices,
    seqNums,
    seqAnswer,
    seqChoices,
    blinkAt,
  }
}

// ─── Shape SVG ───────────────────────────────────────────────────────────────

function ShapeIcon({ shape, size = 64 }: { shape: Shape; size?: number }) {
  const s = size
  const c = '#00d4ff'
  if (shape === 'circle')
    return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke={c} strokeWidth="3" />
      </svg>
    )
  if (shape === 'square')
    return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <rect x="6" y="6" width="36" height="36" fill="none" stroke={c} strokeWidth="3" />
      </svg>
    )
  if (shape === 'triangle')
    return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <polygon points="24,4 44,44 4,44" fill="none" stroke={c} strokeWidth="3" />
      </svg>
    )
  if (shape === 'diamond')
    return (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <polygon points="24,3 45,24 24,45 3,24" fill="none" stroke={c} strokeWidth="3" />
      </svg>
    )
  // pentagon
  return (
    <svg width={s} height={s} viewBox="0 0 48 48">
      <polygon points="24,3 45,18 37,42 11,42 3,18" fill="none" stroke={c} strokeWidth="3" />
    </svg>
  )
}

// ─── Round score ─────────────────────────────────────────────────────────────

interface RoundScore {
  counter: boolean
  shape: boolean
  seq: boolean
  blink: boolean
}

// ─── Quadrant button grid ────────────────────────────────────────────────────

function ChoiceGrid({
  choices,
  selected,
  correct,
  onSelect,
  render,
}: {
  choices: (string | number)[]
  selected: string | number | null
  correct: string | number
  onSelect: (v: string | number) => void
  render?: (v: string | number) => React.ReactNode
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {choices.map((c) => {
        const isSelected = selected === c
        const isCorrect = c === correct
        let border = 'border-[#0e2040]'
        let text = 'text-[#c8dff0]'
        if (selected !== null) {
          if (isCorrect) { border = 'border-[#00ff9f]'; text = 'text-[#00ff9f]' }
          else if (isSelected) { border = 'border-[#ff3b5c]'; text = 'text-[#ff3b5c]' }
        }
        return (
          <button
            key={String(c)}
            onClick={() => selected === null && onSelect(c)}
            disabled={selected !== null}
            className={`py-2 rounded border ${border} ${text} font-mono text-sm transition-colors hover:border-[#00d4ff] hover:text-[#00d4ff] disabled:cursor-default disabled:hover:border-[${border}]`}
          >
            {render ? render(c) : String(c)}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type Phase = 'intro' | 'running' | 'roundFeedback' | 'done'

export function MultiAttention() {
  const navigate = useNavigate()
  const { recordResult, getModuleScore } = useStore()

  const [phase, setPhase] = useState<Phase>('intro')
  const [round, setRound] = useState(0)
  const [setup, setSetup] = useState<RoundSetup | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const [counterAnswer, setCounterAnswer] = useState<number | null>(null)
  const [shapeAnswer, setShapeAnswer] = useState<Shape | null>(null)
  const [seqAnswer, setSeqAnswer] = useState<number | null>(null)
  const [blinkState, setBlinkState] = useState<BlinkState>('waiting')
  const [roundScores, setRoundScores] = useState<RoundScore[]>([])
  const [resultRecorded, setResultRecorded] = useState(false)

  // Refs for timer closures
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const setupRef = useRef<RoundSetup | null>(null)
  const counterAnswerRef = useRef<number | null>(null)
  const shapeAnswerRef = useRef<Shape | null>(null)
  const seqAnswerRef = useRef<number | null>(null)
  const blinkStateRef = useRef<BlinkState>('waiting')
  const roundEndedRef = useRef(false)

  const endRound = useCallback(() => {
    if (roundEndedRef.current) return
    roundEndedRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)

    if (blinkStateRef.current === 'flashing') {
      blinkStateRef.current = 'missed'
      setBlinkState('missed')
    }

    const s = setupRef.current!
    const score: RoundScore = {
      counter: counterAnswerRef.current === s.counterAnswer,
      shape: shapeAnswerRef.current === s.shape,
      seq: seqAnswerRef.current === s.seqAnswer,
      blink: blinkStateRef.current === 'hit',
    }
    setRoundScores((prev) => [...prev, score])
    setPhase('roundFeedback')
  }, [])

  const startRound = useCallback(
    (roundNum: number) => {
      const s = generateRound()
      setupRef.current = s
      counterAnswerRef.current = null
      shapeAnswerRef.current = null
      seqAnswerRef.current = null
      blinkStateRef.current = 'waiting'
      roundEndedRef.current = false

      setSetup(s)
      setElapsed(0)
      setCounterAnswer(null)
      setShapeAnswer(null)
      setSeqAnswer(null)
      setBlinkState('waiting')
      setRound(roundNum)
      startTimeRef.current = Date.now()
      setPhase('running')
    },
    []
  )

  useEffect(() => {
    if (phase !== 'running') return
    timerRef.current = setInterval(() => {
      const el = Date.now() - startTimeRef.current
      setElapsed(el)

      const s = setupRef.current!
      const cur = blinkStateRef.current
      if (cur === 'waiting' && el >= s.blinkAt) {
        blinkStateRef.current = 'flashing'
        setBlinkState('flashing')
      } else if (cur === 'flashing' && el >= s.blinkAt + BLINK_DURATION_MS) {
        blinkStateRef.current = 'missed'
        setBlinkState('missed')
      }

      if (el >= ROUND_MS) endRound()
    }, TICK_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase, endRound])

  const handleCounterChoice = (val: number) => {
    if (counterAnswerRef.current !== null) return
    counterAnswerRef.current = val
    setCounterAnswer(val)
  }

  const handleShapeChoice = (shape: Shape) => {
    if (shapeAnswerRef.current !== null) return
    shapeAnswerRef.current = shape
    setShapeAnswer(shape)
  }

  const handleSeqChoice = (val: number) => {
    if (seqAnswerRef.current !== null) return
    seqAnswerRef.current = val
    setSeqAnswer(val)
  }

  const handleBlink = () => {
    if (blinkStateRef.current !== 'flashing') return
    blinkStateRef.current = 'hit'
    setBlinkState('hit')
  }

  const handleViewResults = useCallback(() => {
    if (!resultRecorded) {
      const total = roundScores.reduce(
        (sum, r) =>
          sum +
          (r.counter ? 1 : 0) +
          (r.shape ? 1 : 0) +
          (r.seq ? 1 : 0) +
          (r.blink ? 1 : 0),
        0
      )
      recordResult({
        moduleId: 10,
        score: total,
        total: ROUNDS * 4,
        avgTimeMs: ROUND_MS,
        completedAt: Date.now(),
      })
      setResultRecorded(true)
    }
    setPhase('done')
  }, [roundScores, resultRecorded, recordResult])

  // Derived values during running phase
  const counterTicks = elapsed > 0 && setup ? Math.floor(elapsed / COUNTER_TICK_MS) : 0
  const counterValue = setup ? setup.counterStart + setup.counterDir * counterTicks : 0
  const counterHidden = elapsed >= COUNTER_HIDE_MS
  const shapeVisible =
    setup && elapsed >= SHAPE_APPEAR_MS && elapsed < SHAPE_APPEAR_MS + SHAPE_SHOW_MS
  const shapeQuestionVisible = setup && elapsed >= SHAPE_APPEAR_MS + SHAPE_SHOW_MS
  const timeRemaining = Math.max(0, ROUND_MS - elapsed)
  const timePct = timeRemaining / ROUND_MS

  // ── Done ──────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    const totalCorrect = roundScores.reduce(
      (sum, r) =>
        sum +
        (r.counter ? 1 : 0) +
        (r.shape ? 1 : 0) +
        (r.seq ? 1 : 0) +
        (r.blink ? 1 : 0),
      0
    )
    const modScore = getModuleScore(10)
    return (
      <div className="min-h-screen bg-[#050d1a] flex flex-col items-center justify-center p-6">
        <ResultsScreen
          module={MODULE}
          score={totalCorrect}
          total={ROUNDS * 4}
          avgTimeMs={ROUND_MS}
          personalBest={modScore?.highScore ?? 0}
          onRetry={() => {
            setRoundScores([])
            setResultRecorded(false)
            startRound(0)
          }}
        />
      </div>
    )
  }

  // ── Intro ─────────────────────────────────────────────────────────────────

  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-[#050d1a] flex flex-col items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-6">
          <button
            onClick={() => navigate('/')}
            className="text-[#3a5068] font-mono text-xs hover:text-[#c8dff0] transition-colors"
          >
            ← HOME
          </button>
          <div>
            <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">
              STAGE I · MODULE 10
            </div>
            <h1 className="text-2xl font-semibold text-[#c8dff0]">Multi Attention Test</h1>
          </div>
          <p className="text-[#3a5068] text-sm leading-relaxed">
            Four tasks run simultaneously. You have{' '}
            <span className="text-[#00d4ff]">30 seconds</span> per round to complete all of them.
            Each correct task scores 1 point — max 4 per round.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                icon: '🔢',
                title: 'COUNTER',
                desc: 'A number counts up or down. When it stops, select the correct value.',
              },
              {
                icon: '🔷',
                title: 'SHAPE',
                desc: 'A shape flashes briefly. Identify which shape appeared.',
              },
              {
                icon: '➕',
                title: 'SEQUENCE',
                desc: 'Find the next number in the arithmetic series shown.',
              },
              {
                icon: '⚡',
                title: 'BLINK ALERT',
                desc: 'A button flashes red — click it before it goes dark.',
              },
            ].map(({ icon, title, desc }) => (
              <div
                key={title}
                className="p-3 rounded border border-[#0e2040] bg-[#0a1628] space-y-1"
              >
                <div className="font-mono text-xs text-[#00d4ff]">
                  {icon} {title}
                </div>
                <div className="text-xs text-[#3a5068] leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => startRound(0)}
            className="w-full py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors"
          >
            BEGIN SESSION
          </button>
          <p className="text-center text-[#3a5068] font-mono text-xs">
            Unofficial practice tool — not affiliated with EUROCONTROL, SkyTest, or Nav Canada
          </p>
        </div>
      </div>
    )
  }

  // ── Round Feedback ────────────────────────────────────────────────────────

  if (phase === 'roundFeedback' && roundScores.length > 0) {
    const last = roundScores[roundScores.length - 1]
    const correct = [last.counter, last.shape, last.seq, last.blink].filter(Boolean).length
    const isLast = roundScores.length >= ROUNDS
    const color =
      correct >= 3 ? '#00ff9f' : correct >= 2 ? '#ffb800' : '#ff3b5c'

    return (
      <div className="min-h-screen bg-[#050d1a] flex flex-col items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm w-full text-center space-y-6"
        >
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">
            ROUND {roundScores.length} / {ROUNDS}
          </div>
          <div className="font-mono text-6xl font-bold" style={{ color }}>
            {correct}/4
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'CTR', ok: last.counter },
              { label: 'SHP', ok: last.shape },
              { label: 'SEQ', ok: last.seq },
              { label: 'BLK', ok: last.blink },
            ].map(({ label, ok }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1 p-2 rounded border"
                style={{ borderColor: ok ? '#00ff9f' : '#ff3b5c' }}
              >
                <div
                  className="font-mono text-sm font-bold"
                  style={{ color: ok ? '#00ff9f' : '#ff3b5c' }}
                >
                  {ok ? '✓' : '✗'}
                </div>
                <div className="font-mono text-xs text-[#3a5068]">{label}</div>
              </div>
            ))}
          </div>
          {isLast ? (
            <button
              onClick={handleViewResults}
              className="w-full py-3 rounded border border-[#00ff9f] text-[#00ff9f] font-ui font-medium hover:bg-[#00ff9f] hover:text-[#050d1a] transition-colors"
            >
              VIEW RESULTS
            </button>
          ) : (
            <button
              onClick={() => startRound(round + 1)}
              className="w-full py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors"
            >
              NEXT ROUND →
            </button>
          )}
        </motion.div>
      </div>
    )
  }

  // ── Running ───────────────────────────────────────────────────────────────

  if (!setup) return null

  return (
    <div className="min-h-screen bg-[#050d1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#0e2040]">
        <button
          onClick={() => navigate('/')}
          className="text-[#3a5068] font-mono text-xs hover:text-[#c8dff0] transition-colors"
        >
          ← HOME
        </button>
        <div className="font-mono text-xs text-[#3a5068] tracking-wider">
          MULTI ATTENTION · ROUND {round + 1}/{ROUNDS}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="font-mono text-xs w-8 text-right"
            style={{
              color:
                timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c',
            }}
          >
            {Math.ceil(timeRemaining / 1000)}s
          </div>
          <div className="w-20 h-1.5 rounded bg-[#0a1628] overflow-hidden">
            <div
              className="h-full rounded transition-all duration-100"
              style={{
                width: `${timePct * 100}%`,
                backgroundColor:
                  timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c',
              }}
            />
          </div>
        </div>
      </div>

      {/* 2×2 quadrant grid */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-px bg-[#0e2040]">

        {/* ── Q1: Counter ── */}
        <div className="bg-[#0a1628] p-4 flex flex-col">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-3 flex items-center gap-2">
            <span>COUNTER</span>
            {counterAnswer !== null && (
              <span
                className="font-mono text-xs"
                style={{
                  color:
                    counterAnswer === setup.counterAnswer ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {counterAnswer === setup.counterAnswer ? '✓' : '✗'}
              </span>
            )}
          </div>

          {!counterHidden && (
            <div className="flex-1 flex items-center justify-center">
              <motion.div
                key={counterValue}
                initial={{ y: setup.counterDir > 0 ? 6 : -6, opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                className="font-mono text-5xl text-[#00d4ff]"
              >
                {counterValue}
              </motion.div>
            </div>
          )}

          {counterHidden && counterAnswer === null && (
            <div className="flex-1 flex flex-col">
              <div className="font-mono text-xs text-[#ffb800] text-center mb-2">
                COUNTER STOPPED — SELECT VALUE
              </div>
              <ChoiceGrid
                choices={setup.counterChoices}
                selected={counterAnswer}
                correct={setup.counterAnswer}
                onSelect={(v) => handleCounterChoice(v as number)}
              />
            </div>
          )}

          {counterHidden && counterAnswer !== null && (
            <div className="flex-1 flex items-center justify-center">
              <div
                className="font-mono text-4xl"
                style={{
                  color:
                    counterAnswer === setup.counterAnswer ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {counterAnswer}
              </div>
            </div>
          )}
        </div>

        {/* ── Q2: Shape ── */}
        <div className="bg-[#0a1628] p-4 flex flex-col">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-3 flex items-center gap-2">
            <span>SHAPE TRACKER</span>
            {shapeAnswer !== null && (
              <span
                className="font-mono text-xs"
                style={{
                  color: shapeAnswer === setup.shape ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {shapeAnswer === setup.shape ? '✓' : '✗'}
              </span>
            )}
          </div>

          {!shapeVisible && !shapeQuestionVisible && (
            <div className="flex-1 flex items-center justify-center">
              <div className="font-mono text-xs text-[#3a5068] animate-pulse">
                WAITING FOR SHAPE…
              </div>
            </div>
          )}

          <AnimatePresence>
            {shapeVisible && (
              <motion.div
                key="shape"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                className="flex-1 flex items-center justify-center"
              >
                <ShapeIcon shape={setup.shape} size={80} />
              </motion.div>
            )}
          </AnimatePresence>

          {shapeQuestionVisible && shapeAnswer === null && (
            <div className="flex-1 flex flex-col">
              <div className="font-mono text-xs text-[#ffb800] text-center mb-2">
                WHICH SHAPE APPEARED?
              </div>
              <ChoiceGrid
                choices={setup.shapeChoices}
                selected={shapeAnswer}
                correct={setup.shape}
                onSelect={(v) => handleShapeChoice(v as Shape)}
                render={(v) => (
                  <span className="capitalize">{String(v)}</span>
                )}
              />
            </div>
          )}

          {shapeQuestionVisible && shapeAnswer !== null && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <ShapeIcon
                shape={shapeAnswer}
                size={56}
              />
              <div
                className="font-mono text-xs capitalize"
                style={{
                  color: shapeAnswer === setup.shape ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {shapeAnswer}
              </div>
            </div>
          )}
        </div>

        {/* ── Q3: Number Sequence ── */}
        <div className="bg-[#0a1628] p-4 flex flex-col">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-3 flex items-center gap-2">
            <span>NUMBER SEQUENCE</span>
            {seqAnswer !== null && (
              <span
                className="font-mono text-xs"
                style={{
                  color: seqAnswer === setup.seqAnswer ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {seqAnswer === setup.seqAnswer ? '✓' : '✗'}
              </span>
            )}
          </div>

          <div className="flex items-center justify-center gap-3 mb-4">
            {setup.seqNums.map((n, i) => (
              <span key={i} className="font-mono text-2xl text-[#c8dff0]">
                {n}
              </span>
            ))}
            <span className="font-mono text-2xl text-[#ffb800]">?</span>
          </div>

          {seqAnswer === null ? (
            <ChoiceGrid
              choices={setup.seqChoices}
              selected={seqAnswer}
              correct={setup.seqAnswer}
              onSelect={(v) => handleSeqChoice(v as number)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div
                className="font-mono text-4xl"
                style={{
                  color: seqAnswer === setup.seqAnswer ? '#00ff9f' : '#ff3b5c',
                }}
              >
                {seqAnswer}
              </div>
            </div>
          )}
        </div>

        {/* ── Q4: Blink Alert ── */}
        <div className="bg-[#0a1628] p-4 flex flex-col items-center justify-center gap-4">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">BLINK ALERT</div>

          {blinkState === 'waiting' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-28 h-28 rounded-full border-2 border-[#0e2040] flex items-center justify-center">
                <span className="font-mono text-xs text-[#3a5068]">STANDBY</span>
              </div>
              <div className="font-mono text-xs text-[#3a5068]">Stay alert — it will flash</div>
            </div>
          )}

          {blinkState === 'flashing' && (
            <motion.button
              animate={{
                boxShadow: [
                  '0 0 20px #ff3b5c',
                  '0 0 40px #ff3b5c',
                  '0 0 20px #ff3b5c',
                ],
                scale: [1, 1.06, 1],
              }}
              transition={{ repeat: Infinity, duration: 0.35 }}
              onClick={handleBlink}
              className="w-28 h-28 rounded-full border-4 border-[#ff3b5c] bg-[#ff3b5c]/20 font-mono text-sm font-bold text-[#ff3b5c] cursor-pointer"
            >
              HIT ME
            </motion.button>
          )}

          {blinkState === 'hit' && (
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="w-28 h-28 rounded-full border-4 border-[#00ff9f] flex items-center justify-center"
            >
              <span className="font-mono text-sm text-[#00ff9f] font-bold">GOT IT</span>
            </motion.div>
          )}

          {blinkState === 'missed' && (
            <div className="w-28 h-28 rounded-full border-4 border-[#ff3b5c] flex items-center justify-center">
              <span className="font-mono text-sm text-[#ff3b5c]">MISSED</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
