import { useNavigate } from 'react-router-dom'
import { ProgressBar } from './ProgressBar'
import { TimerBar } from './TimerBar'
import type { ModuleMeta } from '../types'

interface Props {
  module: ModuleMeta
  questionNum: number
  total: number
  timerPct: number
  timerRemaining: number
  children: React.ReactNode
}

export function ModuleShell({ module, questionNum, total, timerPct, timerRemaining, children }: Props) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col radar-grid">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#0e2040] bg-[#050d1a]/80 backdrop-blur-sm">
        <button
          onClick={() => navigate('/')}
          className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors"
          aria-label="Return home"
        >
          ← HOME
        </button>
        <div className="text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-widest">{module.stage}</div>
          <div className="font-ui text-sm font-medium text-[#c8dff0]">{module.name}</div>
        </div>
        <div className="font-mono text-xs text-[#3a5068]">
          Q{questionNum}/{total}
        </div>
      </header>

      {/* Progress & Timer */}
      <div className="px-6 py-3 border-b border-[#0e2040] bg-[#050d1a]/60 space-y-2">
        <ProgressBar current={questionNum - 1} total={total} />
        <TimerBar pct={timerPct} remaining={timerRemaining} />
      </div>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-2xl">
          {children}
        </div>
      </main>
    </div>
  )
}
