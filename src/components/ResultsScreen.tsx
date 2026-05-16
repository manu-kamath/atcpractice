import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import type { ModuleMeta } from '../types'

interface Props {
  module: ModuleMeta
  score: number
  total: number
  avgTimeMs: number
  personalBest: number
  onRetry: () => void
}

export function ResultsScreen({ module, score, total, avgTimeMs, personalBest, onRetry }: Props) {
  const navigate = useNavigate()
  const pct = Math.round((score / total) * 100)
  const isNewBest = pct > personalBest && score > 0
  const avgSec = (avgTimeMs / 1000).toFixed(1)

  const grade =
    pct >= 90 ? { label: 'EXCELLENT', color: '#00ff9f' } :
    pct >= 75 ? { label: 'GOOD', color: '#00d4ff' } :
    pct >= 60 ? { label: 'PASS', color: '#ffb800' } :
    { label: 'FAIL', color: '#ff3b5c' }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-8 py-12"
    >
      <div className="text-center">
        <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-2">SESSION COMPLETE</div>
        <h2 className="text-2xl font-semibold text-[#c8dff0]">{module.name}</h2>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="font-mono text-7xl font-bold" style={{ color: grade.color }}>
          {pct}%
        </div>
        <div className="font-mono text-lg tracking-widest" style={{ color: grade.color }}>
          {grade.label}
        </div>
        {isNewBest && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="mt-2 px-3 py-1 rounded border border-[#00ff9f] text-[#00ff9f] font-mono text-xs tracking-widest"
          >
            ★ NEW PERSONAL BEST
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6 w-full max-w-sm">
        {[
          { label: 'CORRECT', value: `${score}/${total}` },
          { label: 'AVG TIME', value: `${avgSec}s` },
          { label: 'BEST', value: `${personalBest}%` },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center gap-1 p-3 rounded border border-[#0e2040] bg-[#0a1628]">
            <div className="font-mono text-xs text-[#3a5068] tracking-wider">{label}</div>
            <div className="font-mono text-xl text-[#00d4ff]">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-4">
        <button
          onClick={onRetry}
          className="px-6 py-2.5 rounded border border-[#00d4ff] text-[#00d4ff] font-ui text-sm font-medium hover:bg-[#00d4ff] hover:text-[#050d1a] transition-colors"
        >
          RETRY
        </button>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2.5 rounded border border-[#3a5068] text-[#3a5068] font-ui text-sm font-medium hover:border-[#c8dff0] hover:text-[#c8dff0] transition-colors"
        >
          HOME
        </button>
      </div>
    </motion.div>
  )
}
