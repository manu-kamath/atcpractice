interface Props {
  current: number
  total: number
}

export function ProgressBar({ current, total }: Props) {
  const pct = Math.round((current / total) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1 bg-[#0e2040] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#00d4ff] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-[#3a5068]">
        {current}/{total}
      </span>
    </div>
  )
}
