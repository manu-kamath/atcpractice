import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 6)!
const QUESTIONS = 8
const TIME_MS = 20000

// ─── Data model ───────────────────────────────────────────────────────────────

interface Rule {
  condition: string
  action: string
  color: string
}

interface RuleSet {
  key: string
  title: string
  subtitle: string
  rules: Rule[]
}

interface ScenarioField {
  label: string
  value: string
  highlight?: boolean   // draws attention to the decision-making field
}

interface QuestionDef {
  ruleSetKey: string
  scenario: ScenarioField[]
  options: string[]
  correctIndex: number
  correctRuleIdx: number   // which rule fires (for post-answer highlight)
  explanation: string
}

// ─── Rule sets ────────────────────────────────────────────────────────────────

const RULE_SETS: Record<string, RuleSet> = {
  squawk: {
    key: 'squawk',
    title: 'SQUAWK CODE PROCEDURES',
    subtitle: 'Apply the correct procedure based on the transponder code squawked.',
    rules: [
      { condition: 'SQUAWK = 7700', action: 'DECLARE EMERGENCY', color: '#ff3b5c' },
      { condition: 'SQUAWK = 7600', action: 'LOST COMMS PROCEDURE', color: '#ffb800' },
      { condition: 'SQUAWK = 7500', action: 'NOTIFY SECURITY SERVICES', color: '#9b59b6' },
    ],
  },
  wake: {
    key: 'wake',
    title: 'WAKE TURBULENCE SEPARATION',
    subtitle: 'Select the required radar separation based on aircraft weight categories.',
    rules: [
      { condition: 'LEAD = SUPER (e.g. A380)', action: 'APPLY 6nm MINIMUM', color: '#ff3b5c' },
      { condition: 'LEAD = HEAVY  AND  FOLLOW = LIGHT', action: 'APPLY 8nm MINIMUM', color: '#ffb800' },
      { condition: 'LEAD = HEAVY  AND  FOLLOW ≠ LIGHT', action: 'APPLY 5nm MINIMUM', color: '#00d4ff' },
    ],
  },
  approach: {
    key: 'approach',
    title: 'APPROACH CATEGORY SELECTION',
    subtitle: 'Select the approach type permitted by current ceiling and visibility.',
    rules: [
      { condition: 'CEILING < 200ft  OR  VIS < 0.5nm', action: 'CAT III ILS ONLY', color: '#ff3b5c' },
      { condition: 'CEILING 200–499ft  AND  VIS ≥ 0.5nm', action: 'CAT I / II ILS', color: '#ffb800' },
      { condition: 'CEILING ≥ 500ft  AND  VIS ≥ 3nm', action: 'VISUAL APPROACH', color: '#00ff9f' },
    ],
  },
}

// ─── Pre-defined questions (shuffled within each set at runtime) ──────────────

const QUESTION_POOLS: QuestionDef[][] = [
  // ── Set A: Squawk codes (3 questions) ──────────────────────────────────────
  [
    {
      ruleSetKey: 'squawk',
      scenario: [
        { label: 'CALLSIGN', value: 'AIR 102' },
        { label: 'SQUAWK', value: '7700', highlight: true },
        { label: 'ALTITUDE', value: 'FL280' },
        { label: 'POSITION', value: '45nm NW' },
      ],
      options: ['DECLARE EMERGENCY', 'LOST COMMS PROCEDURE', 'NOTIFY SECURITY SERVICES', 'STANDARD HANDLING'],
      correctIndex: 0,
      correctRuleIdx: 0,
      explanation: 'Squawk 7700 = emergency. Declare immediately and provide all assistance.',
    },
    {
      ruleSetKey: 'squawk',
      scenario: [
        { label: 'CALLSIGN', value: 'DAL 445' },
        { label: 'SQUAWK', value: '7600', highlight: true },
        { label: 'ALTITUDE', value: 'FL200' },
        { label: 'POSITION', value: '12nm SE' },
      ],
      options: ['NOTIFY SECURITY SERVICES', 'DECLARE EMERGENCY', 'LOST COMMS PROCEDURE', 'STANDARD HANDLING'],
      correctIndex: 2,
      correctRuleIdx: 1,
      explanation: 'Squawk 7600 = radio failure. Apply lost communications procedure.',
    },
    {
      ruleSetKey: 'squawk',
      scenario: [
        { label: 'CALLSIGN', value: 'UAL 891' },
        { label: 'SQUAWK', value: '7500', highlight: true },
        { label: 'ALTITUDE', value: 'FL350' },
        { label: 'POSITION', value: '82nm NE' },
      ],
      options: ['DECLARE EMERGENCY', 'LOST COMMS PROCEDURE', 'STANDARD HANDLING', 'NOTIFY SECURITY SERVICES'],
      correctIndex: 3,
      correctRuleIdx: 2,
      explanation: 'Squawk 7500 = unlawful interference. Notify security services — do not broadcast on frequency.',
    },
  ],
  // ── Set B: Wake turbulence (3 questions) ───────────────────────────────────
  [
    {
      ruleSetKey: 'wake',
      scenario: [
        { label: 'LEAD AIRCRAFT', value: 'A380 — SUPER', highlight: true },
        { label: 'FOLLOWING', value: 'B737 — MEDIUM' },
        { label: 'WIND', value: 'CALM' },
        { label: 'RUNWAY', value: '28L' },
      ],
      options: ['APPLY 8nm MINIMUM', 'APPLY 5nm MINIMUM', 'APPLY 6nm MINIMUM', 'STANDARD 3nm'],
      correctIndex: 2,
      correctRuleIdx: 0,
      explanation: 'A380 is SUPER category. All following aircraft require 6nm regardless of their category.',
    },
    {
      ruleSetKey: 'wake',
      scenario: [
        { label: 'LEAD AIRCRAFT', value: 'B747 — HEAVY', highlight: true },
        { label: 'FOLLOWING', value: 'C172 — LIGHT', highlight: true },
        { label: 'WIND', value: 'LIGHT CROSSWIND' },
        { label: 'RUNWAY', value: '09R' },
      ],
      options: ['APPLY 6nm MINIMUM', 'APPLY 5nm MINIMUM', 'STANDARD 3nm', 'APPLY 8nm MINIMUM'],
      correctIndex: 3,
      correctRuleIdx: 1,
      explanation: 'Heavy leading a Light aircraft is the highest-risk wake scenario — 8nm required.',
    },
    {
      ruleSetKey: 'wake',
      scenario: [
        { label: 'LEAD AIRCRAFT', value: 'B777 — HEAVY', highlight: true },
        { label: 'FOLLOWING', value: 'A320 — MEDIUM', highlight: true },
        { label: 'WIND', value: 'CALM' },
        { label: 'RUNWAY', value: '34L' },
      ],
      options: ['APPLY 8nm MINIMUM', 'APPLY 6nm MINIMUM', 'APPLY 5nm MINIMUM', 'STANDARD 3nm'],
      correctIndex: 2,
      correctRuleIdx: 2,
      explanation: 'Heavy leading Medium (not Light) falls under Rule 3 — 5nm minimum.',
    },
  ],
  // ── Set C: Approach categories (2 questions) ───────────────────────────────
  [
    {
      ruleSetKey: 'approach',
      scenario: [
        { label: 'CEILING', value: '100ft AGL', highlight: true },
        { label: 'VISIBILITY', value: '0.3nm (RVR 500m)', highlight: true },
        { label: 'WIND', value: '010/05kt' },
        { label: 'RUNWAY', value: '27' },
      ],
      options: ['VISUAL APPROACH', 'CAT I / II ILS', 'DIVERT — NO APPROACH', 'CAT III ILS ONLY'],
      correctIndex: 3,
      correctRuleIdx: 0,
      explanation: 'Ceiling 100ft < 200ft threshold. Only CAT III ILS authorised.',
    },
    {
      ruleSetKey: 'approach',
      scenario: [
        { label: 'CEILING', value: '800ft AGL', highlight: true },
        { label: 'VISIBILITY', value: '5nm', highlight: true },
        { label: 'WIND', value: '270/12kt' },
        { label: 'RUNWAY', value: '27' },
      ],
      options: ['CAT III ILS ONLY', 'CAT I / II ILS', 'DIVERT — NO APPROACH', 'VISUAL APPROACH'],
      correctIndex: 3,
      correctRuleIdx: 2,
      explanation: 'Ceiling 800ft ≥ 500ft and vis 5nm ≥ 3nm — visual approach conditions met.',
    },
  ],
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildSession(): QuestionDef[] {
  // Shuffle within each pool, then concatenate in set order
  return [
    ...shuffle(QUESTION_POOLS[0]),
    ...shuffle(QUESTION_POOLS[1]),
    ...shuffle(QUESTION_POOLS[2]),
  ]
}

// ─── Rule Card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, lit }: { rule: Rule; lit: boolean }) {
  return (
    <motion.div
      animate={lit ? { scale: [1, 1.03, 1] } : {}}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-0 rounded overflow-hidden border text-sm"
      style={{
        borderColor: lit ? rule.color : '#0e2040',
        boxShadow: lit ? `0 0 14px ${rule.color}55` : 'none',
        background: lit ? `${rule.color}18` : '#0a1628',
      }}
    >
      <div
        className="px-3 py-2.5 font-mono text-xs shrink-0 border-r"
        style={{
          color: rule.color,
          borderColor: lit ? rule.color : '#0e2040',
          background: `${rule.color}12`,
          minWidth: 120,
        }}
      >
        IF&nbsp; {rule.condition}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 font-mono text-xs" style={{ color: '#c8dff0' }}>
        <span className="text-[#3a5068]">→</span>
        <span style={{ color: lit ? rule.color : '#c8dff0', fontWeight: lit ? 700 : 400 }}>
          {rule.action}
        </span>
      </div>
    </motion.div>
  )
}

// ─── Scenario Display ─────────────────────────────────────────────────────────

function ScenarioBlock({ fields }: { fields: ScenarioField[] }) {
  return (
    <div className="rounded-lg border border-[#0e2040] bg-[#080f1e] p-4 grid grid-cols-2 gap-x-8 gap-y-2">
      {fields.map((f) => (
        <div key={f.label} className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-[#3a5068] tracking-wider shrink-0 w-24">
            {f.label}
          </span>
          <span
            className="font-mono text-sm"
            style={{
              color: f.highlight ? '#00d4ff' : '#c8dff0',
              fontWeight: f.highlight ? 700 : 400,
              textShadow: f.highlight ? '0 0 8px rgba(0,212,255,0.6)' : 'none',
            }}
          >
            {f.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Module ───────────────────────────────────────────────────────────────────

export function LearningRules() {
  const [questions] = useState<QuestionDef[]>(buildSession)
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [scores, setScores] = useState<boolean[]>([])
  const [times, setTimes] = useState<number[]>([])
  const [done, setDone] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [litRule, setLitRule] = useState<number | null>(null)
  const startRef = useRef(Date.now())

  const recordResult = useStore((s) => s.recordResult)
  const storedScore = useStore((s) => s.getModuleScore(MODULE.id))
  const q = questions[qIdx]
  const ruleSet = RULE_SETS[q.ruleSetKey]

  // Detect rule set change
  const prevRuleSetKey = qIdx > 0 ? questions[qIdx - 1].ruleSetKey : q.ruleSetKey
  const ruleSetChanged = qIdx > 0 && prevRuleSetKey !== q.ruleSetKey

  const advance = useCallback(() => {
    setQIdx((i) => i + 1)
    setSelected(null)
    setFeedback(null)
    setLitRule(null)
    startRef.current = Date.now()
  }, [])

  const handleExpire = useCallback(() => {
    if (selected !== null) return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setLitRule(q.correctRuleIdx)
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 2000)
  }, [selected, qIdx, q, advance])

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
    setLitRule(q.correctRuleIdx)
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 2000)
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
    setScores([]); setTimes([]); setDone(false); setLitRule(null)
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

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={pct} timerRemaining={remaining}>
      <div className="flex flex-col gap-5">

        {/* Rule set panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={ruleSet.key}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28 }}
            className="rounded-lg border border-[#0e2040] bg-[#050d1a] p-4 flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              {ruleSetChanged && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="px-2 py-0.5 rounded border border-[#00ff9f] text-[#00ff9f] font-mono text-[9px] tracking-widest"
                >
                  NEW RULES
                </motion.span>
              )}
              <div>
                <div className="font-mono text-xs text-[#00d4ff] tracking-widest">{ruleSet.title}</div>
                <div className="font-ui text-xs text-[#3a5068] mt-0.5">{ruleSet.subtitle}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {ruleSet.rules.map((rule, i) => (
                <RuleCard key={i} rule={rule} lit={litRule === i} />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Scenario */}
        <AnimatePresence mode="wait">
          <motion.div
            key={qIdx}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }}
          >
            <div className="font-mono text-[10px] text-[#3a5068] tracking-widest mb-2">SCENARIO</div>
            <ScenarioBlock fields={q.scenario} />
          </motion.div>
        </AnimatePresence>

        {/* Answer options */}
        <div className="grid grid-cols-2 gap-2">
          {q.options.map((opt, idx) => {
            const isSelected = selected === idx
            const isCorrect = idx === q.correctIndex
            let borderColor = '#0e2040'
            let textColor = '#c8dff0'
            let bg = '#0a1628'

            if (feedback !== null) {
              if (isCorrect) { borderColor = '#00ff9f'; textColor = '#00ff9f'; bg = '#001a0f' }
              else if (isSelected) { borderColor = '#ff3b5c'; textColor = '#ff3b5c'; bg = '#1a0008' }
            }

            return (
              <motion.button
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                onClick={() => handleSelect(idx)}
                disabled={selected !== null}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default text-left focus:outline-none"
                style={{ borderColor, backgroundColor: bg }}
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
                aria-label={`Option ${idx + 1}: ${opt}`}
              >
                <span className="w-5 h-5 rounded border border-[#0e2040] flex items-center justify-center font-mono text-[10px] text-[#3a5068] shrink-0">
                  {idx + 1}
                </span>
                <span className="font-mono text-xs leading-tight" style={{ color: textColor }}>
                  {opt}
                </span>
                {feedback !== null && (
                  <span className="ml-auto font-mono text-sm shrink-0">
                    {isCorrect ? '✓' : isSelected ? '✗' : ''}
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>

        <FeedbackBanner
          correct={feedback}
          explanation={feedback === false ? q.explanation : ''}
        />
      </div>
    </ModuleShell>
  )
}
