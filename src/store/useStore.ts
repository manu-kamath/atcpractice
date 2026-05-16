import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModuleScore, SessionResult } from '../types'

interface AppState {
  scores: Record<number, ModuleScore>
  history: SessionResult[]
  recordResult: (result: SessionResult) => void
  getModuleScore: (moduleId: number) => ModuleScore | undefined
  getOverallAccuracy: () => number
  getTotalSessions: () => number
}

const defaultScore = (): ModuleScore => ({
  highScore: 0,
  sessions: 0,
  totalCorrect: 0,
  totalQuestions: 0,
})

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      scores: {},
      history: [],

      recordResult: (result) => {
        set((state) => {
          const existing = state.scores[result.moduleId] ?? defaultScore()
          const pct = Math.round((result.score / result.total) * 100)
          const updated: ModuleScore = {
            highScore: Math.max(existing.highScore, pct),
            sessions: existing.sessions + 1,
            totalCorrect: existing.totalCorrect + result.score,
            totalQuestions: existing.totalQuestions + result.total,
          }
          return {
            scores: { ...state.scores, [result.moduleId]: updated },
            history: [result, ...state.history].slice(0, 200),
          }
        })
      },

      getModuleScore: (moduleId) => get().scores[moduleId],

      getOverallAccuracy: () => {
        const { scores } = get()
        const all = Object.values(scores)
        if (!all.length) return 0
        const totalQ = all.reduce((s, m) => s + m.totalQuestions, 0)
        const totalC = all.reduce((s, m) => s + m.totalCorrect, 0)
        return totalQ === 0 ? 0 : Math.round((totalC / totalQ) * 100)
      },

      getTotalSessions: () => {
        const { scores } = get()
        return Object.values(scores).reduce((s, m) => s + m.sessions, 0)
      },
    }),
    {
      name: 'feast-atco-store',
    }
  )
)
