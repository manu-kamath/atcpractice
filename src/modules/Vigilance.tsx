import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ResultsScreen } from '../components/ResultsScreen'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 13)!
const NUM_TARGETS = 8
const STREAM_LENGTH = 56        // 56 slots × 350ms ≈ 19.6 s
const INTERVAL_MS = 350
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// ─── Stream generation ────────────────────────────────────────────────────────

function generateTarget(): string {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)]
}

function generateStream(target: string): string[] {
  const pool = CHARSET.split('').filter((c) => c !== target)
  const stream = Array.from({ length: STREAM_LENGTH }, () =>
    pool[Math.floor(Math.random() * pool.length)]
  )
  // Place one target per equal-sized segment to guarantee 8 appearances
  const seg = Math.floor(STREAM_LENGTH / NUM_TARGETS)
  for (let i = 0; i < NUM_TARGETS; i++) {
    const lo = i * seg + 2
    const hi = Math.min((i + 1) * seg - 2, STREAM_LENGTH - 2)
    const pos = lo + Math.floor(Math.random() * (hi - lo + 1))
    stream[pos] = target
  }
  return stream
}

// ─── Module ───────────────────────────────────────────────────────────────────

type Phase = 'intro' | 'running' | 'done'

export function Vigilance() {
  const navigate = useNavigate()
  const { recordResult, getModuleScore } = useStore()

  const [retryKey, setRetryKey] = useState(0)
  const [target, setTarget] = useState(() => generateTarget())
  const [stream, setStream] = useState(() => generateStream(target))
  const [phase, setPhase] = useState<Phase>('intro')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [hits, setHits] = useState(0)
  const [falsePositives, setFalsePositives] = useState(0)
  const [misses, setMisses] = useState(0)

  // Refs for interval/SPACE-handler cross-reads
  const currentIdxRef = useRef(0)
  const streamRef = useRef(stream)
  const targetRef = useRef(target)
  const spaceUsedRef = useRef(false)
  const hitsRef = useRef(0)
  const falsePositivesRef = useRef(0)
  const missesRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep stream/target refs current on retry
  useEffect(() => {
    streamRef.current = stream
    targetRef.current = target
  }, [stream, target])

  const endSession = useCallback(() => {
    // Score the very last slot
    const lastChar = streamRef.current[streamRef.current.length - 1]
    if (lastChar === targetRef.current && !spaceUsedRef.current) {
      missesRef.current += 1
      setMisses((m) => m + 1)
    }
    setPhase('done')
    const score = hitsRef.current
    recordResult({
      moduleId: MODULE.id,
      score,
      total: NUM_TARGETS,
      avgTimeMs: INTERVAL_MS,
      completedAt: Date.now(),
    })
  }, [recordResult])

  const startSession = useCallback(() => {
    currentIdxRef.current = 0
    spaceUsedRef.current = false
    setCurrentIdx(0)
    setPhase('running')

    intervalRef.current = setInterval(() => {
      // Score current slot before advancing
      const idx = currentIdxRef.current
      const char = streamRef.current[idx]
      if (char === targetRef.current && !spaceUsedRef.current) {
        missesRef.current += 1
        setMisses((m) => m + 1)
      }

      const next = idx + 1
      if (next >= streamRef.current.length) {
        clearInterval(intervalRef.current!)
        endSession()
        return
      }

      spaceUsedRef.current = false
      currentIdxRef.current = next
      setCurrentIdx(next)
    }, INTERVAL_MS)
  }, [endSession])

  // Clean up on unmount
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  // SPACE / tap handler during run
  const handleReact = useCallback(() => {
    if (spaceUsedRef.current) return
    const idx = currentIdxRef.current
    if (idx < 0 || idx >= streamRef.current.length) return
    spaceUsedRef.current = true
    if (streamRef.current[idx] === targetRef.current) {
      hitsRef.current += 1
      setHits((h) => h + 1)
    } else {
      falsePositivesRef.current += 1
      setFalsePositives((fp) => fp + 1)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'running') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); handleReact() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, handleReact])

  const handleRetry = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const newTarget = generateTarget()
    const newStream = generateStream(newTarget)
    setTarget(newTarget)
    setStream(newStream)
    streamRef.current = newStream
    targetRef.current = newTarget
    currentIdxRef.current = 0
    spaceUsedRef.current = false
    hitsRef.current = 0
    falsePositivesRef.current = 0
    missesRef.current = 0
    setCurrentIdx(0)
    setHits(0)
    setFalsePositives(0)
    setMisses(0)
    setPhase('intro')
    setRetryKey((k) => k + 1)
  }

  const storedScore = getModuleScore(MODULE.id)
  const progressPct = STREAM_LENGTH > 0 ? (currentIdx / (STREAM_LENGTH - 1)) * 100 : 0

  // ── Done ────────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col items-center justify-center px-6 py-12 gap-8">
        <ResultsScreen
          module={MODULE}
          score={hits}
          total={NUM_TARGETS}
          avgTimeMs={INTERVAL_MS}
          personalBest={storedScore?.highScore ?? 0}
          onRetry={handleRetry}
        />
        {/* False-positive detail */}
        <div className="flex gap-8 font-mono text-xs">
          <div className="text-center">
            <div className="text-[#3a5068] tracking-widest">HITS</div>
            <div className="text-[#00ff9f] text-xl mt-0.5">{hits}</div>
          </div>
          <div className="text-center">
            <div className="text-[#3a5068] tracking-widest">MISSES</div>
            <div className="text-[#ffb800] text-xl mt-0.5">{misses}</div>
          </div>
          <div className="text-center">
            <div className="text-[#3a5068] tracking-widest">FALSE +</div>
            <div className="text-[#ff3b5c] text-xl mt-0.5">{falsePositives}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Intro ────────────────────────────────────────────────────────────────────

  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040]">
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
          <div className="w-16" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
          <div className="text-center space-y-2">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">YOUR TARGET</div>
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="font-mono text-[96px] font-bold leading-none"
              style={{ color: '#ffb800', textShadow: '0 0 40px #ffb80088' }}
            >
              {target}
            </motion.div>
            <div className="font-mono text-xs text-[#3a5068]">memorise this letter</div>
          </div>

          <div className="max-w-sm text-center space-y-3 text-sm text-[#3a5068] leading-relaxed">
            <p>
              Characters will flash one at a time.{' '}
              <span className="text-[#c8dff0]">Press SPACE</span>{' '}
              (or tap the button) each time you see{' '}
              <span className="text-[#ffb800] font-bold">{target}</span>.
            </p>
            <p className="text-xs">
              Misses and false positives both count against you.
            </p>
          </div>

          <button
            onClick={startSession}
            className="px-10 py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors"
          >
            START
          </button>

          <p className="text-center text-[#3a5068] font-mono text-xs">
            Unofficial practice tool — not affiliated with EUROCONTROL, SkyTest, or Nav Canada
          </p>
        </div>
      </div>
    )
  }

  // ── Running ──────────────────────────────────────────────────────────────────

  const currentChar = stream[currentIdx] ?? ''
  const isTarget = currentChar === target

  return (
    <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col select-none">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040] bg-[#050d1a]/80 backdrop-blur-sm">
        <button
          onClick={() => navigate('/')}
          className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors"
        >
          ← HOME
        </button>
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">VIGILANCE</div>
        </div>
        {/* Live score */}
        <div className="flex gap-3 font-mono text-xs">
          <span className="text-[#00ff9f]">H:{hits}</span>
          <span className="text-[#ff3b5c]">F:{falsePositives}</span>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1 bg-[#0a1628]">
        <motion.div
          className="h-full bg-[#00d4ff]"
          style={{ width: `${progressPct}%` }}
          transition={{ duration: 0.35, ease: 'linear' }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-between py-6 px-4 gap-4">

        {/* Target reminder */}
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">WATCH FOR</div>
          <div
            className="font-mono text-2xl font-bold px-3 py-1 rounded border border-[#ffb80055] bg-[#ffb80011]"
            style={{ color: '#ffb800' }}
          >
            {target}
          </div>
        </div>

        {/* Character display */}
        <div className="flex-1 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${retryKey}-${currentIdx}`}
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.75 }}
              transition={{ duration: 0.06 }}
              className="font-mono font-bold leading-none"
              style={{
                fontSize: 120,
                color: isTarget ? '#ffb800' : '#00d4ff',
                textShadow: isTarget
                  ? '0 0 60px #ffb80099'
                  : '0 0 30px #00d4ff44',
              }}
            >
              {currentChar}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* SPACE tap button */}
        <div className="w-full max-w-xs space-y-3">
          <motion.button
            onPointerDown={handleReact}
            whileTap={{ scale: 0.96 }}
            className="w-full py-5 rounded-xl border-2 border-[#0e2040] bg-[#0a1628] font-mono text-sm text-[#3a5068] tracking-widest active:border-[#00d4ff] active:text-[#00d4ff] transition-colors"
          >
            PRESS SPACE / TAP
          </motion.button>
          <div className="flex justify-between font-mono text-xs text-[#3a5068] px-1">
            <span>{currentIdx + 1} / {STREAM_LENGTH}</span>
            <span>{NUM_TARGETS - hits - misses} targets remaining</span>
          </div>
        </div>
      </div>
    </div>
  )
}
