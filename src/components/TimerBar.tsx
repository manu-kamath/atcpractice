interface Props {
  pct: number
  remaining: number
}

export function TimerBar({ pct, remaining }: Props) {
  const color = pct > 50 ? '#00ff9f' : pct > 25 ? '#ffb800' : '#ff3b5c'
  const secs = (remaining / 1000).toFixed(1)

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-[#0e2040] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-sm w-12 text-right" style={{ color }}>
        {secs}s
      </span>
    </div>
  )
}
