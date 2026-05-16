import { useEffect } from 'react'

export function useKeyPress(key: string, handler: () => void, deps: unknown[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === key && !e.repeat) handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
