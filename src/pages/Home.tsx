import { Header } from '../components/Header'
import { ModuleCard } from '../components/ModuleCard'
import { FEAST_I, FEAST_II } from '../modules/config'

function StageSection({ title, subtitle, modules, accent }: {
  title: string
  subtitle: string
  modules: typeof FEAST_I
  accent: string
}) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline gap-3 mb-6">
        <h2 className="font-ui text-xl font-semibold" style={{ color: accent }}>{title}</h2>
        <span className="font-mono text-xs text-[#3a5068]">{subtitle}</span>
        <div className="flex-1 h-px bg-[#0e2040]" />
        <span className="font-mono text-xs text-[#3a5068]">{modules.length} MODULES</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {modules.map((mod, i) => (
          <ModuleCard key={mod.id} module={mod} index={i} />
        ))}
      </div>
    </section>
  )
}

export function Home() {
  return (
    <div className="min-h-screen flex flex-col radar-grid">
      <Header />

      <main className="flex-1 px-6 py-8 max-w-7xl mx-auto w-full">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="font-mono text-xs text-[#3a5068] tracking-[0.3em] mb-2">
            AIR TRAFFIC CONTROLLER APTITUDE TEST PREPARATION
          </div>
          <h1 className="font-ui text-4xl font-bold text-[#c8dff0] mb-3">
            FEAST<span className="text-[#00d4ff]"> PRACTICE</span>
          </h1>
          <p className="font-ui text-sm text-[#3a5068] max-w-xl mx-auto">
            Simulated aptitude modules for Nav Canada FEAST Stage I & II selection.
            Each session is 8 questions with real-time feedback and personal best tracking.
          </p>
        </div>

        {/* Modules */}
        <StageSection
          title="FEAST STAGE I"
          subtitle="COGNITIVE & PERCEPTUAL"
          modules={FEAST_I}
          accent="#00d4ff"
        />
        <StageSection
          title="FEAST STAGE II"
          subtitle="ATC SIMULATION"
          modules={FEAST_II}
          accent="#00ff9f"
        />

        {/* Footer */}
        <footer className="text-center py-6 border-t border-[#0e2040]">
          <p className="font-mono text-xs text-[#3a5068]">
            FEAST ATCO PRACTICE — FOR PREPARATION USE ONLY — NOT AFFILIATED WITH NAV CANADA
          </p>
        </footer>
      </main>
    </div>
  )
}
