import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ModuleShell } from '../components/ModuleShell'
import { FeedbackBanner } from '../components/FeedbackBanner'
import { ResultsScreen } from '../components/ResultsScreen'
import { useTimer } from '../hooks/useTimer'
import { useKeyPress } from '../hooks/useKeyPress'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 8)!
const QUESTIONS = 8
const TIME_MS = 12000
const STUDY_MS = 4000   // how long panel is visible

// ─── Instrument types & readings ─────────────────────────────────────────────

interface InstrumentReading {
  type: 'altimeter' | 'heading' | 'airspeed' | 'vsi'
  value: number   // raw value; meaning depends on type
}

interface Panel {
  instruments: InstrumentReading[]
}

interface Question {
  panel: Panel
  query: string                  // e.g. "What was the ALTITUDE reading?"
  options: string[]              // 4 formatted answer strings
  correctIndex: number
  instrument: InstrumentReading  // which instrument is being queried
}

function randInt(lo: number, hi: number) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo
}

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Nice round altimeter values
function randAlt(): number { return randInt(1, 45) * 500 }          // 500–22500 ft
function randHdg(): number { return randInt(0, 35) * 10 }            // 000–350°
function randSpd(): number { return randItem([80, 100, 120, 140, 160, 180, 200, 220, 240, 260]) }
function randVsi(): number { return randItem([-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000]) }

function fmtAlt(v: number) { return `${v.toLocaleString()} ft` }
function fmtHdg(v: number) { return `${String(v).padStart(3, '0')}°` }
function fmtSpd(v: number) { return `${v} kt` }
function fmtVsi(v: number) { return v === 0 ? '0 fpm' : `${v > 0 ? '+' : ''}${v} fpm` }

function fmt(inst: InstrumentReading): string {
  switch (inst.type) {
    case 'altimeter': return fmtAlt(inst.value)
    case 'heading':   return fmtHdg(inst.value)
    case 'airspeed':  return fmtSpd(inst.value)
    case 'vsi':       return fmtVsi(inst.value)
  }
}

function queryLabel(type: InstrumentReading['type']): string {
  switch (type) {
    case 'altimeter': return 'ALTITUDE'
    case 'heading':   return 'HEADING'
    case 'airspeed':  return 'AIRSPEED'
    case 'vsi':       return 'VERTICAL SPEED'
  }
}

function generateDistractors(inst: InstrumentReading, n: number): number[] {
  const out = new Set<number>()
  while (out.size < n) {
    let v: number
    switch (inst.type) {
      case 'altimeter': {
        const offsets = [-2000, -1500, -1000, -500, 500, 1000, 1500, 2000]
        v = inst.value + randItem(offsets)
        v = Math.max(500, Math.min(22500, Math.round(v / 500) * 500))
        break
      }
      case 'heading': {
        const offsets = [-30, -20, -10, 10, 20, 30]
        v = ((inst.value + randItem(offsets)) + 360) % 360
        v = Math.round(v / 10) * 10 % 360
        break
      }
      case 'airspeed': {
        const all = [80, 100, 120, 140, 160, 180, 200, 220, 240, 260]
        v = randItem(all.filter((x) => x !== inst.value))
        break
      }
      case 'vsi': {
        const all = [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000]
        v = randItem(all.filter((x) => x !== inst.value))
        break
      }
    }
    if (v !== inst.value && !out.has(v)) out.add(v)
  }
  return [...out]
}

function generateQuestion(qIdx: number): Question {
  const nInstr = qIdx < 3 ? 4 : qIdx < 6 ? 5 : 6

  const types: InstrumentReading['type'][] = ['altimeter', 'heading', 'airspeed', 'vsi']
  // For 5-6 instruments add extras: second altimeter at different alt, second heading
  const extraTypes: InstrumentReading['type'][] = ['altimeter', 'heading']

  const instTypes = types.slice()
  for (let i = 4; i < nInstr; i++) instTypes.push(extraTypes[i - 4])

  const instruments: InstrumentReading[] = instTypes.map((type) => ({
    type,
    value: type === 'altimeter' ? randAlt()
         : type === 'heading'   ? randHdg()
         : type === 'airspeed'  ? randSpd()
         : randVsi(),
  }))

  // Pick one instrument to query (avoid duplicates for clarity: pick from first 4)
  const queryIdx = randInt(0, 3)
  const instrument = instruments[queryIdx]
  const distractors = generateDistractors(instrument, 3)

  const allOpts = [instrument.value, ...distractors]
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5)
  const options = order.map((i) => {
    const v = allOpts[i]
    return fmt({ type: instrument.type, value: v })
  })
  const correctIndex = order.indexOf(0)

  return {
    panel: { instruments },
    query: `What was the ${queryLabel(instrument.type)} reading?`,
    options,
    correctIndex,
    instrument,
  }
}

// ─── Canvas instrument drawing ────────────────────────────────────────────────

const SIZE = 110  // canvas size per gauge

function drawGaugeBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Outer bezel
  ctx.fillStyle = '#0a1220'
  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill()
  // Face
  const grad = ctx.createRadialGradient(cx, cy - r * 0.2, 0, cx, cy, r)
  grad.addColorStop(0, '#0d1e30')
  grad.addColorStop(1, '#060f1a')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  // Bezel ring
  ctx.strokeStyle = '#1a3050'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.stroke()
}

function drawTickMarks(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  count: number, startAngle: number, endAngle: number,
  majorEvery: number
) {
  const span = endAngle - startAngle
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (i / count) * span
    const isMajor = i % majorEvery === 0
    const len = isMajor ? 10 : 5
    const x1 = cx + Math.cos(a) * (r - 2)
    const y1 = cy + Math.sin(a) * (r - 2)
    const x2 = cx + Math.cos(a) * (r - 2 - len)
    const y2 = cy + Math.sin(a) * (r - 2 - len)
    ctx.strokeStyle = isMajor ? 'rgba(0,212,255,0.8)' : 'rgba(0,212,255,0.3)'
    ctx.lineWidth = isMajor ? 1.5 : 1
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  }
}

function drawNeedle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, angle: number, color: string
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, r * 0.15)
  ctx.lineTo(0, -r * 0.75)
  ctx.stroke()
  // Centre pin
  ctx.fillStyle = '#c8dff0'
  ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

function drawLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, text: string) {
  ctx.font = '8px "Share Tech Mono"'
  ctx.fillStyle = 'rgba(0,212,255,0.45)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy + r * 0.55)
}

function drawValueText(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, color = '#00d4ff') {
  ctx.font = 'bold 10px "Share Tech Mono"'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy + 26)
}

// Altimeter: 0–25000 ft, two hands (1000s and 100s)
function drawAltimeter(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alt: number) {
  drawGaugeBase(ctx, cx, cy, r)
  drawTickMarks(ctx, cx, cy, r, 50, -Math.PI * 0.75, Math.PI * 0.75, 5)
  drawLabel(ctx, cx, cy, r, 'ALT')

  // Scale: 0–1000 ft per full rotation → 10 marks = 100ft each
  // But show 0–25000 ft range. Use thousands hand (slow) and hundreds hand (fast)
  const hundreds = (alt % 1000) / 1000       // 0–1 representing 100ft increments
  const thousands = (alt / 10000) % 1         // slow hand

  const span = Math.PI * 1.5
  const start = -Math.PI * 0.75

  drawNeedle(ctx, cx, cy, r, start + thousands * span, 'rgba(0,212,255,0.5)')
  drawNeedle(ctx, cx, cy, r, start + hundreds * span, '#00d4ff')
  drawValueText(ctx, cx, cy, fmtAlt(alt))
}

// Heading: 0–360°
function drawHeading(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, hdg: number) {
  drawGaugeBase(ctx, cx, cy, r)

  // Compass rose: 36 marks
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2
    const isMajor = i % 9 === 0
    const len = isMajor ? 10 : i % 3 === 0 ? 7 : 4
    ctx.strokeStyle = isMajor ? 'rgba(0,212,255,0.9)' : 'rgba(0,212,255,0.3)'
    ctx.lineWidth = isMajor ? 1.5 : 1
    const x1 = cx + Math.cos(a) * (r - 2); const y1 = cy + Math.sin(a) * (r - 2)
    const x2 = cx + Math.cos(a) * (r - 2 - len); const y2 = cy + Math.sin(a) * (r - 2 - len)
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  }

  // Cardinal labels
  const cardinals = ['N', 'E', 'S', 'W']
  cardinals.forEach((c, i) => {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2
    ctx.font = 'bold 9px "Share Tech Mono"'
    ctx.fillStyle = c === 'N' ? '#00ff9f' : 'rgba(0,212,255,0.7)'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(c, cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14))
  })

  drawLabel(ctx, cx, cy, r, 'HDG')

  const angle = (hdg / 360) * Math.PI * 2 - Math.PI / 2
  drawNeedle(ctx, cx, cy, r, angle, '#00d4ff')
  drawValueText(ctx, cx, cy, fmtHdg(hdg))
}

// Airspeed: 0–300 kt
function drawAirspeed(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spd: number) {
  drawGaugeBase(ctx, cx, cy, r)
  drawTickMarks(ctx, cx, cy, r, 30, -Math.PI * 0.75, Math.PI * 0.75, 5)
  drawLabel(ctx, cx, cy, r, 'IAS kt')

  // Green arc 80–200kt
  const start = -Math.PI * 0.75
  const span = Math.PI * 1.5
  const toAngle = (v: number) => start + (v / 300) * span
  ctx.strokeStyle = 'rgba(0,255,159,0.4)'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 6, toAngle(80), toAngle(200))
  ctx.stroke()

  const angle = start + Math.min(spd, 300) / 300 * span
  drawNeedle(ctx, cx, cy, r, angle, '#00d4ff')
  drawValueText(ctx, cx, cy, fmtSpd(spd))
}

// VSI: -2000 to +2000 fpm
function drawVsi(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, vsi: number) {
  drawGaugeBase(ctx, cx, cy, r)
  drawTickMarks(ctx, cx, cy, r, 20, -Math.PI * 0.75, Math.PI * 0.75, 5)
  drawLabel(ctx, cx, cy, r, 'VSI')

  const start = -Math.PI * 0.75
  const span = Math.PI * 1.5
  const norm = (vsi + 2000) / 4000   // 0 at -2000, 1 at +2000
  const angle = start + norm * span
  const color = vsi > 0 ? '#00ff9f' : vsi < 0 ? '#ff3b5c' : '#00d4ff'
  drawNeedle(ctx, cx, cy, r, angle, color)
  drawValueText(ctx, cx, cy, fmtVsi(vsi), color)
}

function drawInstrument(canvas: HTMLCanvasElement, inst: InstrumentReading, hidden: boolean) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#050d1a'
  ctx.fillRect(0, 0, W, H)

  if (hidden) {
    // Covered instrument
    ctx.fillStyle = '#0a1628'
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 4, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1a3050'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#3a5068'; ctx.font = '24px "Share Tech Mono"'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('?', W / 2, H / 2)
    return
  }

  const cx = W / 2, cy = H / 2, r = W / 2 - 6
  switch (inst.type) {
    case 'altimeter': drawAltimeter(ctx, cx, cy, r, inst.value); break
    case 'heading':   drawHeading(ctx, cx, cy, r, inst.value); break
    case 'airspeed':  drawAirspeed(ctx, cx, cy, r, inst.value); break
    case 'vsi':       drawVsi(ctx, cx, cy, r, inst.value); break
  }
}

// ─── Gauge component ──────────────────────────────────────────────────────────

function Gauge({ inst, hidden, label }: { inst: InstrumentReading; hidden: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawInstrument(ref.current, inst, hidden) }, [inst, hidden])
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas ref={ref} width={SIZE} height={SIZE} aria-label={hidden ? 'Hidden instrument' : label} />
      <span className="font-mono text-[9px] text-[#3a5068] tracking-wider">{label}</span>
    </div>
  )
}

const INST_LABELS: Record<InstrumentReading['type'], string> = {
  altimeter: 'ALTIMETER',
  heading: 'HEADING IND',
  airspeed: 'AIRSPEED IND',
  vsi: 'VERT SPEED',
}

// ─── Module ───────────────────────────────────────────────────────────────────

type Phase = 'study' | 'recall' | 'feedback'

export function MemorizeInstruments() {
  const [questions] = useState<Question[]>(() =>
    Array.from({ length: QUESTIONS }, (_, i) => generateQuestion(i))
  )
  const [qIdx, setQIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('study')
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [studyCountdown, setStudyCountdown] = useState(STUDY_MS / 1000)
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
    setPhase('study')
    setSelected(null)
    setFeedback(null)
    setStudyCountdown(STUDY_MS / 1000)
    startRef.current = Date.now()
  }, [])

  // Study phase: auto-transition after STUDY_MS
  useEffect(() => {
    if (phase !== 'study') return
    setStudyCountdown(STUDY_MS / 1000)
    const tick = setInterval(() => setStudyCountdown((c) => Math.max(0, +(c - 0.1).toFixed(1))), 100)
    const t = setTimeout(() => {
      clearInterval(tick)
      setPhase('recall')
      startRef.current = Date.now()
    }, STUDY_MS)
    return () => { clearTimeout(t); clearInterval(tick) }
  }, [phase, qIdx, retryKey])

  const handleExpire = useCallback(() => {
    if (selected !== null || phase !== 'recall') return
    setTimes((t) => [...t, TIME_MS])
    setScores((s) => [...s, false])
    setFeedback(false)
    setPhase('feedback')
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 2000)
  }, [selected, phase, qIdx, advance])

  const { remaining, pct, start, reset } = useTimer(TIME_MS, handleExpire)

  // Start recall timer when phase switches to recall
  useEffect(() => {
    if (phase !== 'recall') { reset(TIME_MS); return }
    const t = setTimeout(start, 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIdx, retryKey])

  const handleSelect = useCallback((idx: number) => {
    if (selected !== null || phase !== 'recall') return
    reset()
    const elapsed = Date.now() - startRef.current
    const correct = idx === q.correctIndex
    setSelected(idx)
    setFeedback(correct)
    setPhase('feedback')
    setTimes((t) => [...t, elapsed])
    setScores((s) => [...s, correct])
    setTimeout(() => { if (qIdx + 1 >= QUESTIONS) setDone(true); else advance() }, 2000)
  }, [selected, phase, q, qIdx, advance, reset])

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
    setQIdx(0); setPhase('study'); setSelected(null); setFeedback(null)
    setScores([]); setTimes([]); setDone(false); setStudyCountdown(STUDY_MS / 1000)
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

  const isStudy = phase === 'study'
  const nInstr = q.panel.instruments.length

  // For 5- and 6-instrument panels, arrange in two rows
  const cols = nInstr <= 4 ? 4 : nInstr === 5 ? 3 : 3

  return (
    <ModuleShell module={MODULE} questionNum={qIdx + 1} total={QUESTIONS}
      timerPct={isStudy ? (studyCountdown / (STUDY_MS / 1000)) * 100 : pct}
      timerRemaining={isStudy ? studyCountdown * 1000 : remaining}>
      <div className="flex flex-col gap-6">

        {/* Phase banner */}
        <AnimatePresence mode="wait">
          <motion.div key={phase}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="text-center">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">
              {isStudy ? 'STUDY PHASE' : phase === 'recall' ? 'RECALL PHASE' : 'RESULT'}
            </div>
            <h2 className="font-ui text-xl font-semibold text-[#c8dff0]">
              {isStudy
                ? <><span className="text-[#00d4ff]">Memorise</span> the instrument panel — {studyCountdown.toFixed(1)}s</>
                : <>{q.query}</>
              }
            </h2>
            {isStudy && (
              <p className="font-mono text-xs text-[#3a5068] mt-1">Panel hides in {studyCountdown.toFixed(1)}s</p>
            )}
            {phase === 'recall' && (
              <p className="font-mono text-xs text-[#3a5068] mt-1">Keys 1–4 or click to answer</p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Instrument panel */}
        <div className={`flex flex-wrap justify-center gap-3`}
          style={{ maxWidth: `${cols * (SIZE + 16)}px`, margin: '0 auto' }}>
          {q.panel.instruments.map((inst, i) => (
            <Gauge
              key={i}
              inst={inst}
              hidden={!isStudy}
              label={INST_LABELS[inst.type]}
            />
          ))}
        </div>

        {/* Answer options (only in recall / feedback) */}
        <AnimatePresence>
          {!isStudy && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-2">
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
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => handleSelect(idx)}
                    disabled={selected !== null}
                    className="flex items-center gap-2 px-4 py-3 rounded-lg border transition-all duration-150 cursor-pointer disabled:cursor-default focus:outline-none"
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
                    <span className="font-mono text-sm" style={{ color: textColor }}>{opt}</span>
                    {feedback !== null && (
                      <span className="ml-auto font-mono text-sm">
                        {isCorrect ? '✓' : isSelected ? '✗' : ''}
                      </span>
                    )}
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <FeedbackBanner
          correct={feedback}
          explanation={
            feedback === false
              ? `The ${queryLabel(q.instrument.type)} read ${fmt(q.instrument)}.`
              : ''
          }
        />
      </div>
    </ModuleShell>
  )
}
