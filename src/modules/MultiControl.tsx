import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ResultsScreen } from '../components/ResultsScreen'
import { useStore } from '../store/useStore'
import { MODULES } from './config'

const MODULE = MODULES.find((m) => m.id === 15)!
const ROUNDS   = 8
const ROUND_MS = 30_000
const CS       = 220    // mini radar canvas size

const AIRPORTS = ['JFK','LAX','ORD','DFW','ATL','BOS','MIA','SEA','SFO','DEN','PHX','LAS','MSP','DTW']
const PREFIXES = ['AAL','UAL','DAL','SWA','BAW','KLM','AFR','DLH','QFA','RYR','EZY','THY']
const HDG_POOL = [45, 90, 135, 180, 225, 270, 315, 360]
const FL_POOL  = [260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370]

// ─── Data generation ──────────────────────────────────────────────────────────

function rnd(min: number, max: number) { return min + Math.random() * (max - min) }
function randItem<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)] }
function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5) }

function makeCS(used: Set<string>): string {
  let s: string
  do { s = PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + (100 + Math.floor(Math.random() * 900)) }
  while (used.has(s))
  used.add(s); return s
}

function makeAP(exclude?: string): string {
  let a: string
  do { a = randItem(AIRPORTS) } while (a === exclude)
  return a
}

interface RadarAc {
  id: string
  callsign: string
  x: number     // 0-1 normalized canvas coords
  y: number
  hdg: number   // degrees, for drawing
  conflict: boolean
}

interface Strip {
  id: string
  callsign: string
  route: string
  currentFl: number
  pending: { desc: string; correctFl: number; options: number[] } | null
}

interface RoundData {
  radarAircraft: RadarAc[]
  conflictId: string
  correctHdg: number
  hdgOptions: number[]
  strips: Strip[]
  targetStripId: string
}

function makeRound(): RoundData {
  const used = new Set<string>()

  // ── Radar task ──────────────────────────────────────────────────────────────
  const numAc = 2 + Math.floor(Math.random() * 2)  // 2 or 3
  const radarAircraft: RadarAc[] = Array.from({ length: numAc }, (_, i) => ({
    id: `ac${i}`,
    callsign: makeCS(used),
    x: rnd(0.15, 0.85),
    y: rnd(0.15, 0.85),
    hdg: Math.floor(rnd(0, 36)) * 10,
    conflict: i === 0,
  }))
  const conflictId = 'ac0'

  // Correct heading is a random entry from HDG_POOL; wrong ones are different
  const correctHdg = randItem(HDG_POOL)
  const hdgOptions = shuffle([correctHdg, ...shuffle(HDG_POOL.filter(h => h !== correctHdg)).slice(0, 3)])

  // ── Strip task ──────────────────────────────────────────────────────────────
  const targetIdx = Math.floor(Math.random() * 3)
  const strips: Strip[] = Array.from({ length: 3 }, (_, i) => {
    const from = makeAP()
    const fl   = randItem(FL_POOL)
    const isPending = i === targetIdx
    let pending: Strip['pending'] = null
    if (isPending) {
      const delta = Math.random() < 0.5 ? -20 : 20
      const newFl = fl + delta
      const wrong1 = fl + delta * 2
      const wrong2 = fl - delta
      pending = {
        desc:      delta < 0 ? `requests descent to FL${newFl}` : `requests climb to FL${newFl}`,
        correctFl: newFl,
        options:   shuffle([newFl, wrong1, wrong2]),
      }
    }
    return {
      id: `s${i}`,
      callsign: makeCS(used),
      route: `${from}→${makeAP(from)}`,
      currentFl: fl,
      pending,
    }
  })
  const targetStripId = `s${targetIdx}`

  return { radarAircraft, conflictId, correctHdg, hdgOptions, strips, targetStripId }
}

function buildSession(): RoundData[] {
  return Array.from({ length: ROUNDS }, makeRound)
}

// ─── Mini radar canvas ────────────────────────────────────────────────────────

function drawRadar(canvas: HTMLCanvasElement, aircraft: RadarAc[], selectedId: string | null) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const cx = W / 2, cy = H / 2
  ctx.clearRect(0, 0, W, H)

  ctx.fillStyle = '#060e1c'
  ctx.fillRect(0, 0, W, H)

  // Rings
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, (W / 2 - 5) * i / 3, 0, Math.PI * 2)
    ctx.strokeStyle = '#0c1a30'; ctx.lineWidth = 0.6; ctx.stroke()
  }

  // Aircraft
  for (const ac of aircraft) {
    const x = ac.x * W, y = ac.y * H
    const color = ac.conflict ? '#ffb800' : '#00d4ff'
    const isSelected = ac.id === selectedId

    const headRad = ((ac.hdg - 90) * Math.PI) / 180
    const sz = 5
    ctx.save(); ctx.translate(x, y); ctx.rotate(headRad)
    ctx.beginPath()
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.65, sz * 0.75); ctx.lineTo(-sz * 0.65, sz * 0.75)
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
    if (isSelected) {
      ctx.beginPath(); ctx.arc(0, 0, sz + 4, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffb800'; ctx.lineWidth = 1.5; ctx.stroke()
    }
    ctx.restore()

    // Speed vector
    ctx.beginPath(); ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(headRad) * 16, y + Math.sin(headRad) * 16)
    ctx.strokeStyle = color + '66'; ctx.lineWidth = 1; ctx.stroke()

    // Callsign
    ctx.font = '8px "Share Tech Mono", monospace'
    ctx.textAlign = 'left'; ctx.fillStyle = color
    ctx.fillText(ac.callsign, x + 8, y - 2)
  }

  // Conflict indicator: pulsing ring (drawn as a larger circle around conflict ac)
  const cac = aircraft.find(a => a.conflict)!
  const cx2 = cac.x * W, cy2 = cac.y * H
  ctx.beginPath(); ctx.arc(cx2, cy2, 12, 0, Math.PI * 2)
  ctx.strokeStyle = '#ffb80066'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke()
  ctx.setLineDash([])
}

// ─── Module ────────────────────────────────────────────────────────────────────

type Phase = 'intro' | 'running' | 'roundFeedback' | 'done'

interface RoundResult { radar: boolean; strip: boolean }

export function MultiControl() {
  const navigate = useNavigate()
  const { recordResult, getModuleScore } = useStore()

  const [rounds]    = useState<RoundData[]>(buildSession)
  const [roundIdx,  setRoundIdx]  = useState(0)
  const [phase,     setPhase]     = useState<Phase>('intro')
  const [timeLeft,  setTimeLeft]  = useState(ROUND_MS)
  const [results,   setResults]   = useState<RoundResult[]>([])
  const [resultRec, setResultRec] = useState(false)

  // Radar task state
  const [radarSel,  setRadarSel]  = useState<string | null>(null)  // selected ac id
  const [radarHdg,  setRadarHdg]  = useState<number | null>(null)  // chosen heading
  const [radarDone, setRadarDone] = useState(false)

  // Strip task state
  const [stripFl,   setStripFl]   = useState<number | null>(null)  // chosen FL
  const [stripDone, setStripDone] = useState(false)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const startRef     = useRef(0)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const roundEndedRef = useRef(false)

  const currentRound = rounds[roundIdx]

  // Redraw radar when selection changes
  useEffect(() => {
    if (canvasRef.current && phase === 'running') {
      drawRadar(canvasRef.current, currentRound.radarAircraft, radarSel)
    }
  }, [radarSel, currentRound, phase])

  const endRound = useCallback(() => {
    if (roundEndedRef.current) return
    roundEndedRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)

    const r = rounds[roundIdx]
    const radarOk = radarHdg === r.correctHdg
    const stripOk = stripFl  === r.strips.find(s => s.pending)?.pending?.correctFl
    setResults(prev => [...prev, { radar: radarOk, strip: stripOk }])
    setPhase('roundFeedback')
  }, [rounds, roundIdx, radarHdg, stripFl])

  // Auto-end when both tasks complete
  useEffect(() => {
    if (phase === 'running' && radarDone && stripDone) {
      endRound()
    }
  }, [phase, radarDone, stripDone, endRound])

  const startRound = useCallback((idx: number) => {
    roundEndedRef.current = false
    setRoundIdx(idx)
    setPhase('running')
    setTimeLeft(ROUND_MS)
    setRadarSel(null); setRadarHdg(null); setRadarDone(false)
    setStripFl(null); setStripDone(false)
    startRef.current = Date.now()

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const el = Date.now() - startRef.current
      const tl = Math.max(0, ROUND_MS - el)
      setTimeLeft(tl)
      if (tl === 0) endRound()
    }, 100)
  }, [endRound])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  // Draw initial radar frame when round starts
  useEffect(() => {
    if (phase === 'running' && canvasRef.current) {
      drawRadar(canvasRef.current, rounds[roundIdx].radarAircraft, null)
    }
  }, [phase, roundIdx, rounds])

  const handleViewResults = useCallback(() => {
    if (!resultRec) {
      const total = results.reduce((s, r) => s + (r.radar ? 1 : 0) + (r.strip ? 1 : 0), 0)
      const avg = ROUND_MS / 2
      recordResult({ moduleId: MODULE.id, score: total, total: ROUNDS * 2, avgTimeMs: avg, completedAt: Date.now() })
      setResultRec(true)
    }
    setPhase('done')
  }, [results, resultRec, recordResult])

  const handleRadarSelect = (id: string) => {
    if (radarDone) return
    setRadarSel(id)
  }

  const handleHdgSelect = (hdg: number) => {
    if (radarDone) return
    setRadarHdg(hdg)
    setRadarDone(true)
  }

  const handleStripAmend = (fl: number) => {
    if (stripDone) return
    setStripFl(fl)
    setStripDone(true)
  }

  const storedScore = getModuleScore(MODULE.id)
  const timePct = timeLeft / ROUND_MS

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const total = results.reduce((s, r) => s + (r.radar ? 1 : 0) + (r.strip ? 1 : 0), 0)
    const avg = ROUND_MS / 2
    return (
      <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col items-center justify-center px-6">
        <ResultsScreen module={MODULE} score={total} total={ROUNDS * 2}
          avgTimeMs={avg} personalBest={storedScore?.highScore ?? 0}
          onRetry={() => {
            setResults([]); setResultRec(false)
            setPhase('intro'); setRoundIdx(0)
          }}
        />
      </div>
    )
  }

  // ── Intro ─────────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-[#050d1a] radar-grid flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040]">
          <button onClick={() => navigate('/')} className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors">← HOME</button>
          <div className="text-center">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">{MODULE.stage}</div>
            <div className="font-ui text-sm font-medium text-[#c8dff0]">{MODULE.name}</div>
          </div>
          <div className="w-16" />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 max-w-lg mx-auto text-center">
          <div className="space-y-2">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">STAGE II · MODULE 15</div>
            <h1 className="text-2xl font-semibold text-[#c8dff0]">Multi Control Test</h1>
          </div>
          <div className="grid grid-cols-2 gap-3 text-left max-w-sm w-full">
            {[
              { icon: '📡', t: 'Radar Task', d: 'Select the conflict aircraft, then issue the correct heading.' },
              { icon: '📄', t: 'Strip Task',  d: 'Identify the strip with a pending amendment and update it.' },
            ].map(({ icon, t, d }) => (
              <div key={t} className="flex flex-col gap-1 p-3 rounded border border-[#0e2040] bg-[#0a1628]">
                <div className="font-mono text-xs text-[#00d4ff]">{icon} {t}</div>
                <div className="font-ui text-xs text-[#3a5068] leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
          <p className="text-[#3a5068] text-sm">
            Both tasks run simultaneously. <span className="text-[#00d4ff]">30 seconds</span> per round.
            Max <span className="text-[#00d4ff]">2 points</span> per round.
          </p>
          <button onClick={() => startRound(0)}
            className="px-10 py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors">
            BEGIN SESSION
          </button>
          <p className="font-mono text-xs text-[#3a5068]">Unofficial practice tool — not affiliated with EUROCONTROL, SkyTest, or Nav Canada</p>
        </div>
      </div>
    )
  }

  // ── Round Feedback ────────────────────────────────────────────────────────────
  if (phase === 'roundFeedback' && results.length > 0) {
    const last = results[results.length - 1]
    const pts = (last.radar ? 1 : 0) + (last.strip ? 1 : 0)
    const isLast = results.length >= ROUNDS

    return (
      <div className="min-h-screen bg-[#050d1a] flex flex-col items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm w-full text-center space-y-6">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">ROUND {results.length} / {ROUNDS}</div>
          <div className="font-mono text-6xl font-bold" style={{ color: pts === 2 ? '#00ff9f' : pts === 1 ? '#ffb800' : '#ff3b5c' }}>
            {pts}/2
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[{ label: 'RADAR', ok: last.radar }, { label: 'STRIPS', ok: last.strip }].map(({ label, ok }) => (
              <div key={label} className="flex flex-col items-center gap-1 p-3 rounded border" style={{ borderColor: ok ? '#00ff9f' : '#ff3b5c' }}>
                <div className="font-mono text-sm font-bold" style={{ color: ok ? '#00ff9f' : '#ff3b5c' }}>{ok ? '✓' : '✗'}</div>
                <div className="font-mono text-xs text-[#3a5068]">{label}</div>
              </div>
            ))}
          </div>
          {isLast ? (
            <button onClick={handleViewResults}
              className="w-full py-3 rounded border border-[#00ff9f] text-[#00ff9f] font-ui font-medium hover:bg-[#00ff9f] hover:text-[#050d1a] transition-colors">
              VIEW RESULTS
            </button>
          ) : (
            <button onClick={() => startRound(roundIdx + 1)}
              className="w-full py-3 rounded border border-[#00d4ff] text-[#00d4ff] font-ui font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors">
              NEXT ROUND →
            </button>
          )}
        </motion.div>
      </div>
    )
  }

  // ── Running ───────────────────────────────────────────────────────────────────
  const r = currentRound

  return (
    <div className="min-h-screen bg-[#050d1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#0e2040]">
        <button onClick={() => navigate('/')} className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors">← HOME</button>
        <div className="font-mono text-xs text-[#3a5068] tracking-wider">MULTI CONTROL · ROUND {roundIdx + 1}/{ROUNDS}</div>
        <div className="flex items-center gap-2">
          <div className="font-mono text-xs w-6 text-right" style={{ color: timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c' }}>
            {Math.ceil(timeLeft / 1000)}
          </div>
          <div className="w-20 h-1.5 rounded bg-[#0a1628] overflow-hidden">
            <div className="h-full rounded transition-all duration-100" style={{
              width: `${timePct * 100}%`,
              backgroundColor: timePct > 0.5 ? '#00ff9f' : timePct > 0.25 ? '#ffb800' : '#ff3b5c',
            }} />
          </div>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 grid grid-cols-2 gap-px bg-[#0e2040]">

        {/* ── LEFT: Radar Task ── */}
        <div className="bg-[#0a1628] p-3 flex flex-col gap-3 overflow-auto">
          <div className="flex items-center gap-2">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">RADAR SCOPE</div>
            {radarDone && <span className="font-mono text-xs text-[#00ff9f]">✓ DONE</span>}
          </div>

          {/* Mini radar canvas */}
          <canvas ref={canvasRef} width={CS} height={CS}
            className="rounded border border-[#0e2040] w-full" style={{ maxWidth: CS }} />

          {/* Step 1: select aircraft */}
          {!radarDone && (
            <div className="space-y-2">
              {!radarSel ? (
                <>
                  <div className="font-mono text-[10px] text-[#ffb800] tracking-wider">SELECT CONFLICT AIRCRAFT</div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.radarAircraft.map(ac => (
                      <button key={ac.id} onClick={() => handleRadarSelect(ac.id)}
                        className="px-3 py-1.5 rounded border border-[#0e2040] font-mono text-xs text-[#c8dff0] hover:border-[#ffb800] hover:text-[#ffb800] transition-colors">
                        {ac.callsign}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-[10px] text-[#ffb800] tracking-wider">
                    ISSUE HEADING TO {r.radarAircraft.find(a => a.id === radarSel)?.callsign}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {r.hdgOptions.map(hdg => (
                      <button key={hdg} onClick={() => handleHdgSelect(hdg)}
                        className="py-2 rounded border border-[#0e2040] font-mono text-xs text-[#c8dff0] hover:border-[#00d4ff] hover:text-[#00d4ff] transition-colors">
                        {String(hdg).padStart(3, '0')}°
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {radarDone && radarHdg !== null && (
            <div className="font-mono text-xs text-center" style={{ color: radarHdg === r.correctHdg ? '#00ff9f' : '#ff3b5c' }}>
              Issued {String(radarHdg).padStart(3, '0')}°
              {radarHdg !== r.correctHdg && <span className="text-[#3a5068] ml-1">/ correct: {String(r.correctHdg).padStart(3, '0')}°</span>}
            </div>
          )}
        </div>

        {/* ── RIGHT: Strip Board ── */}
        <div className="bg-[#0a1628] p-3 flex flex-col gap-3 overflow-auto">
          <div className="flex items-center gap-2">
            <div className="font-mono text-xs text-[#3a5068] tracking-widest">STRIP BOARD</div>
            {stripDone && <span className="font-mono text-xs text-[#00ff9f]">✓ DONE</span>}
          </div>

          {r.strips.map(strip => {
            const isPending = strip.id === r.targetStripId
            const isAnswered = stripDone && isPending

            return (
              <div key={strip.id} className="rounded border px-3 py-2 space-y-1"
                style={{ borderColor: isPending ? '#ffb800' : '#0e2040', background: isPending ? '#ffb80008' : '#080f1e' }}>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs text-[#00d4ff]">{strip.callsign}</div>
                  {isPending && !isAnswered && (
                    <span className="font-mono text-[9px] text-[#ffb800] border border-[#ffb80044] rounded px-1">ACTION</span>
                  )}
                  {isAnswered && (
                    <span className="font-mono text-[9px]" style={{ color: stripFl === strip.pending?.correctFl ? '#00ff9f' : '#ff3b5c' }}>
                      {stripFl === strip.pending?.correctFl ? '✓' : '✗'}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-[#3a5068]">{strip.route}</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#c8dff0]">FL{strip.currentFl}</span>
                  {isPending && strip.pending && !isAnswered && (
                    <span className="font-mono text-[10px] text-[#ffb800]">— {strip.pending.desc}</span>
                  )}
                  {isAnswered && stripFl !== null && (
                    <span className="font-mono text-xs" style={{ color: stripFl === strip.pending?.correctFl ? '#00ff9f' : '#ff3b5c' }}>
                      → FL{stripFl}
                    </span>
                  )}
                </div>

                {/* Amendment buttons */}
                {isPending && strip.pending && !stripDone && (
                  <div className="pt-1 flex gap-1.5 flex-wrap">
                    {strip.pending.options.map(fl => (
                      <button key={fl} onClick={() => handleStripAmend(fl)}
                        className="px-2 py-1 rounded border border-[#0e2040] font-mono text-xs text-[#c8dff0] hover:border-[#00d4ff] hover:text-[#00d4ff] transition-colors">
                        FL{fl}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
