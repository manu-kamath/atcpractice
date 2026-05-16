import { useState, useEffect, useRef, useCallback } from 'react'

export function useTimer(initialMs: number, onExpire?: () => void) {
  const [remaining, setRemaining] = useState(initialMs)
  const [running, setRunning] = useState(false)
  const expireRef = useRef(onExpire)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  expireRef.current = onExpire

  const clear = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  const start = useCallback(() => {
    clear()
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 100) {
          clear()
          setRunning(false)
          expireRef.current?.()
          return 0
        }
        return r - 100
      })
    }, 100)
  }, [])

  const stop = useCallback(() => {
    clear()
    setRunning(false)
  }, [])

  const reset = useCallback((ms?: number) => {
    clear()
    setRunning(false)
    setRemaining(ms ?? initialMs)
  }, [initialMs])

  useEffect(() => () => clear(), [])

  const pct = Math.max(0, Math.min(100, (remaining / initialMs) * 100))

  return { remaining, running, pct, start, stop, reset }
}
