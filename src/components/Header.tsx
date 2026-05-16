import { useStore } from '../store/useStore'

export function Header() {
  const accuracy = useStore((s) => s.getOverallAccuracy())
  const sessions = useStore((s) => s.getTotalSessions())

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 py-3 border-b border-[#0e2040] bg-[#050d1a]/95 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-[#00ff9f] animate-pulse" />
        <span className="font-mono text-xs text-[#3a5068] tracking-widest">NAV CANADA</span>
        <span className="font-mono text-xs text-[#0e2040]">|</span>
        <span className="font-ui text-sm font-semibold text-[#00d4ff] glow-cyan">ATCO TRAINER</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="font-mono text-xs text-[#3a5068]">OVERALL ACCURACY</div>
          <div className="font-mono text-sm text-[#00d4ff]">
            {sessions > 0 ? `${accuracy}%` : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-xs text-[#3a5068]">SESSIONS</div>
          <div className="font-mono text-sm text-[#00ff9f]">{sessions}</div>
        </div>
      </div>
    </header>
  )
}
