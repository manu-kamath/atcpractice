export type Stage = 'FEAST I' | 'FEAST II'

export interface ModuleMeta {
  id: number
  slug: string
  name: string
  description: string
  icon: string
  stage: Stage
  path: string
}

export interface SessionResult {
  moduleId: number
  score: number
  total: number
  avgTimeMs: number
  completedAt: number
}

export interface ModuleScore {
  highScore: number
  sessions: number
  totalCorrect: number
  totalQuestions: number
}
