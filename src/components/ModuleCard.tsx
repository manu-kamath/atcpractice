import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import type { ModuleMeta } from '../types'
import { useStore } from '../store/useStore'

interface Props {
  module: ModuleMeta
  index: number
}

export function ModuleCard({ module, index }: Props) {
  const navigate = useNavigate()
  const score = useStore((s) => s.getModuleScore(module.id))
  const isII = module.stage === 'FEAST II'
  const accentColor = isII ? '#00ff9f' : '#00d4ff'

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      onClick={() => navigate(module.path)}
      className="group relative flex flex-col gap-3 p-4 rounded-lg border border-[#0e2040] bg-[#0a1628] text-left hover:border-opacity-100 transition-all duration-200 cursor-pointer"
      style={{
        '--hover-color': accentColor,
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.borderColor = accentColor
        ;(e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px ${accentColor}22`
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.borderColor = '#0e2040'
        ;(e.currentTarget as HTMLElement).style.boxShadow = ''
      }}
      aria-label={`Start ${module.name}`}
    >
      {/* Stage badge */}
      <div
        className="absolute top-3 right-3 font-mono text-[10px] tracking-widest px-1.5 py-0.5 rounded border"
        style={{ color: accentColor, borderColor: `${accentColor}44`, background: `${accentColor}11` }}
      >
        {isII ? 'II' : 'I'}
      </div>

      {/* Icon */}
      <div className="text-2xl">{module.icon}</div>

      {/* Name */}
      <div>
        <div className="font-ui text-sm font-semibold text-[#c8dff0] leading-tight group-hover:text-white transition-colors">
          {module.name}
        </div>
        <div className="font-ui text-xs text-[#3a5068] mt-1 leading-relaxed">
          {module.description}
        </div>
      </div>

      {/* Score */}
      <div className="mt-auto pt-2 border-t border-[#0e2040] flex items-center justify-between">
        <span className="font-mono text-[10px] text-[#3a5068] tracking-wider">BEST</span>
        <span
          className="font-mono text-sm"
          style={{ color: score?.highScore ? accentColor : '#3a5068' }}
        >
          {score?.highScore ? `${score.highScore}%` : '—'}
        </span>
      </div>
    </motion.button>
  )
}
