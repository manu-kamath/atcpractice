import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE  = MODULES.find((m) => m.id === 17)!
const ROUNDS  = 8
const TIME_MS = 20_000

const PREFIXES  = ['AAL','UAL','DAL','SWA','BAW','KLM','AFR','DLH','QFA','RYR','EZY','THY']
const AIRPORTS  = ['JFK','LAX','ORD','DFW','ATL','BOS','MIA','SEA','SFO','DEN','PHX','LAS','MSP','DTW','PHL']
const FIXES     = ['BOSOX','MERIT','DAFFS','CRISY','SARDI','KARRS','FORAY','BANES','WAVEY','DULET','ELIOT','COLIN']
const FL_POOL   = [260,270,280,290,300,310,320,330,340,350,360,370,380,390,400]

// ─── Data generation ──────────────────────────────────────────────────────────

type EventKind = 'fl' | 'route' | 'squawk'

interface Strip {
  id:       string
  callsign: string
  route:    string
  fl:       number
  squawk:   string
}

interface StripEvent {
  kind:         EventKind
  targetId:     string      // strip id
  announcement: string
  field:        string      // label for the amended column
  options:      string[]    // 3 choices
  correctIdx:   number
  explanation:  string
}

interface Question {
  strips: Strip[]
  event:  StripEvent
}

function rnd(a: number, b: number) { return Math.floor(a + Math.random() * (b - a + 1)) }
function randItem<T>(a: T[]): T  { return a[Math.floor(Math.random() * a.length)] }
function shuffle<T>(a: T[]): T[] { return [...a].sort(() => Math.random() - 0.5) }

function makeCS(used: Set<string>): string {
  let s: string
  do { s = randItem(PREFIXES) + rnd(100, 999) } while (used.has(s))
  used.add(s); return s
}

function makeSquawk(): string {
  // Octal digits only (0-7) — 4 digits
  return Array.from({ length: 4 }, () => rnd(0, 7)).join('')
}

function makeStrips(count: number): Strip[] {
  const used = new Set<string>()
  return Array.from({ length: count }, (_, i) => {
    const from = randItem(AIRPORTS)
    let to: string; do { to = randItem(AIRPORTS) } while (to === from)
    return {
      id:       `s${i}`,
      callsign: makeCS(used),
      route:    `${from}→${to}`,
      fl:       randItem(FL_POOL),
      squawk:   makeSquawk(),
    }
  })
}

function makeEvent(strips: Strip[]): StripEvent {
  const target = strips[Math.floor(Math.random() * strips.length)]
  const kind: EventKind = (['fl', 'fl', 'route', 'squawk'] as EventKind[])[Math.floor(Math.random() * 4)]

  if (kind === 'fl') {
    const delta     = Math.random() < 0.5 ? -20 : 20
    const newFl     = target.fl + delta
    const dir       = delta < 0 ? 'descent' : 'climb'
    const wrong1    = newFl + 20
    const wrong2    = newFl - 20
    const options   = shuffle([String(newFl), String(wrong1), String(wrong2)])
    const correctIdx = options.indexOf(String(newFl))
    return {
      kind, targetId: target.id,
      announcement: `${target.callsign} requests ${dir} to FL${newFl}`,
      field: 'ALTITUDE',
      options: options.map(v => `FL${v}`),
      correctIdx,
      explanation: `Update ${target.callsign} to FL${newFl}`,
    }
  }

  if (kind === 'route') {
    const correct = randItem(FIXES)
    const pool    = FIXES.filter(f => f !== correct)
    const [w1, w2] = shuffle(pool)
    const options  = shuffle([correct, w1, w2])
    return {
      kind, targetId: target.id,
      announcement: `${target.callsign} routing amended, direct ${correct}`,
      field: 'DIRECT',
      options,
      correctIdx: options.indexOf(correct),
      explanation: `Route ${target.callsign} direct ${correct}`,
    }
  }

  // squawk
  const correct = makeSquawk()
  const w1      = makeSquawk()
  const w2      = makeSquawk()
  const options  = shuffle([correct, w1, w2])
  return {
    kind, targetId: target.id,
    announcement: `${target.callsign} assigned squawk ${correct}`,
    field: 'SQUAWK',
    options,
    correctIdx: options.indexOf(correct),
    explanation: `Set ${target.callsign} squawk to ${correct}`,
  }
}

function makeQuestion(qi: number): Question {
  const count  = qi < 4 ? 4 : 5    // 4 strips early, 5 later
  const strips = makeStrips(count)
  const event  = makeEvent(strips)
  return { strips, event }
}

function buildSession(): Question[] {
  return Array.from({ length: ROUNDS }, (_, i) => makeQuestion(i))
}

// ─── Module ────────────────────────────────────────────────────────────────────

export function StripDisplay() {
  const [questions]              = useState<Question[]>(buildSession)
  const [qIdx,     setQIdx]      = useState(0)
  const [selStrip, setSelStrip]  = useState<string | null>(null)
  const [selOpt,   setSelOpt]    = useState<number | null>(null)
  const [feedback, setFeedback]  = useState<boolean | null>(null)
  const [scores,   setScores]    = useState<boolean[]>([])
  const [times,    setTimes]     = useState<number[]>([])
  const [done,     setDone]      = useState(false)
  const [retryKey, setRetryKey]  = useState(0)
  const startRef = useRef(Date.now())

  const recordResult = useStore((s) => s.recordResult)
  const storedScore  = useStore((s) => s.getModuleScore(MODULE.id))
  const q = questions[qIdx]

  const advance = useCallback(() => {
    setQIdx((i) => i + 1)
    setSelStrip(null); setSelOpt(null); setFeedback(null)
    startRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (feedback !== null) return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [feedback, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  useEffect(() => {
    reset(TIME_MS); startRef.current = Date.now()
    const t = setTimeout(start, 50); return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx, retryKey])

  // Step 1: user clicks a strip
  const handleStripClick = useCallback((stripId: string) => {
    if (feedback !== null || selStrip !== null) return
    const isTarget = stripId === q.event.targetId
    if (!isTarget) {
      reset()
      setSelStrip(stripId)
      setTimes((t) => [...t, Date.now() - startRef.current])
      setScores((s) => [...s, false])
      setFeedback(false)
      setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
    } else {
      setSelStrip(stripId)    // highlight strip → options appear
    }
  }, [feedback, selStrip, q, qIdx, advance, reset])

  // Step 2: user picks an amendment option
  const handleOption = useCallback((optIdx: number) => {
    if (feedback !== null || selStrip !== q.event.targetId) return
    reset()
    const correct = optIdx === q.event.correctIdx
    setSelOpt(optIdx)
    setFeedback(correct)
    setTimes((t) => [...t, Date.now() - startRef.current])
    setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= ROUNDS) setDone(true); else advance() }, 2000)
  }, [feedback, selStrip, q, qIdx, advance, reset])

  // Keys 1-3 for options (only active when correct strip selected)
  useKeyPress('1', () => handleOption(0), [handleOption])
  useKeyPress('2', () => handleOption(1), [handleOption])
  useKeyPress('3', () => handleOption(2), [handleOption])

  useEffect(() => {
    if (!done) return
    const correct = scores.filter(Boolean).length
    const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)
    recordResult({ moduleId: MODULE.id, score: correct, total: ROUNDS, avgTimeMs: avg, completedAt: Date.now() })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setQIdx(0); setSelStrip(null); setSelOpt(null); setFeedback(null)
    setScores([]); setTimes([]); setDone(false)
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

  const ev = q.event
  const optionsActive = selStrip === ev.targetId && feedback === null

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={ROUNDS}
      timerPct={pct} timerRemaining={remaining}>
      <AnimatePresence mode="wait">
        <motion.div key={qIdx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
          className="flex flex-col gap-4">

          {/* Event announcement banner */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg border border-[#ffb80066] bg-[#ffb80010] px-4 py-3 space-y-1"
          >
            <div className="font-mono text-[10px] text-[#ffb800] tracking-widest">INCOMING MESSAGE</div>
            <div className="font-ui text-sm text-[#c8dff0] leading-snug">{ev.announcement}</div>
            <div className="font-mono text-[10px] text-[#3a5068]">
              Click the correct strip, then select the amendment
            </div>
          </motion.div>

          {/* Strip board */}
          <div className="flex flex-col gap-2">
            {/* Column headers */}
            <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 px-3">
              {['CALLSIGN','ROUTE','FL','SQUAWK'].map(h => (
                <div key={h} className="font-mono text-[9px] text-[#3a5068] tracking-widest">{h}</div>
              ))}
            </div>

            {q.strips.map((strip) => {
              const isTarget   = strip.id === ev.targetId
              const isSelected = strip.id === selStrip
              const isWrong    = isSelected && feedback === false && !isTarget
              const isFbTarget = feedback !== null && isTarget

              let borderColor = '#0e2040'
              let bgColor     = '#0a1628'
              if (optionsActive && isTarget) { borderColor = '#ffb800'; bgColor = '#ffb80010' }
              else if (isFbTarget && feedback)  { borderColor = '#00ff9f'; bgColor = '#001a0f' }
              else if (isFbTarget && !feedback) { borderColor = '#ff3b5c'; bgColor = '#1a0008' }
              else if (isWrong)                  { borderColor = '#ff3b5c'; bgColor = '#1a0008' }

              return (
                <div key={strip.id}>
                  <motion.button
                    onClick={() => handleStripClick(strip.id)}
                    disabled={feedback !== null || (selStrip !== null)}
                    whileHover={feedback === null && selStrip === null ? { scale: 1.01 } : {}}
                    whileTap={feedback === null && selStrip === null ? { scale: 0.99 } : {}}
                    className="w-full rounded border px-3 py-2.5 grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 text-left transition-colors disabled:cursor-default"
                    style={{ borderColor, background: bgColor }}
                  >
                    <span className="font-mono text-sm" style={{ color: isTarget && (optionsActive || isFbTarget) ? '#ffb800' : '#00d4ff' }}>
                      {strip.callsign}
                    </span>
                    <span className="font-mono text-xs text-[#3a5068] self-center">{strip.route}</span>
                    <span className="font-mono text-xs text-[#c8dff0] self-center">FL{strip.fl}</span>
                    <span className="font-mono text-xs text-[#3a5068] self-center">{strip.squawk}</span>
                  </motion.button>

                  {/* Amendment options — appear only when correct strip is selected */}
                  <AnimatePresence>
                    {optionsActive && isTarget && (
                      <motion.div
                        key="opts"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1.5 ml-2 space-y-1">
                          <div className="font-mono text-[10px] text-[#ffb800] tracking-wider">
                            AMEND {ev.field} — select (keys 1–3)
                          </div>
                          <div className="flex gap-2">
                            {ev.options.map((opt, i) => (
                              <button key={i} onClick={() => handleOption(i)}
                                className="flex-1 py-2 rounded border border-[#0e2040] font-mono text-xs text-[#c8dff0] hover:border-[#00d4ff] hover:text-[#00d4ff] transition-colors">
                                <span className="text-[#3a5068] mr-1">{i + 1}.</span> {opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Post-answer option reveal */}
                    {feedback !== null && isTarget && selOpt !== null && (
                      <motion.div
                        key="reveal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-1 ml-2 flex gap-2"
                      >
                        {ev.options.map((opt, i) => {
                          const isCorrect  = i === ev.correctIdx
                          const isPicked   = i === selOpt
                          let clr = '#3a5068'
                          if (isCorrect) clr = '#00ff9f'
                          else if (isPicked) clr = '#ff3b5c'
                          return (
                            <div key={i} className="flex-1 py-1.5 rounded border text-center font-mono text-xs"
                              style={{ borderColor: clr, color: clr }}>
                              {opt} {isCorrect ? '✓' : isPicked ? '✗' : ''}
                            </div>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          {/* Feedback banner */}
          <FeedbackBanner correct={feedback}
            explanation={feedback === false ? ev.explanation : ''} />
        </motion.div>
      </AnimatePresence>
    </ModuleShell>
  )
}
