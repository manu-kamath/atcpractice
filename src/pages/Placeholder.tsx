import { useNavigate } from 'react-router-dom'
import { MODULES } from '../modules/config'

export function Placeholder({ moduleId }: { moduleId: number }) {
  const navigate = useNavigate()
  const mod = MODULES.find((m) => m.id === moduleId)
  if (!mod) return null
  const accentColor = mod.stage === 'Stage II' ? '#00ff9f' : '#00d4ff'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center radar-grid gap-6 p-8">
      <div className="text-5xl">{mod.icon}</div>
      <div className="text-center">
        <div className="font-mono text-xs text-[#3a5068] tracking-widest mb-1">{mod.stage}</div>
        <h1 className="font-ui text-2xl font-semibold text-[#c8dff0]">{mod.name}</h1>
        <p className="font-ui text-sm text-[#3a5068] mt-2 max-w-sm">{mod.description}</p>
      </div>
      <div
        className="px-4 py-2 rounded border font-mono text-xs tracking-widest"
        style={{ color: accentColor, borderColor: `${accentColor}44`, background: `${accentColor}11` }}
      >
        MODULE COMING SOON
      </div>
      <button
        onClick={() => navigate('/')}
        className="font-mono text-xs text-[#3a5068] hover:text-[#00d4ff] transition-colors"
      >
        ← BACK TO HOME
      </button>
    </div>
  )
}
