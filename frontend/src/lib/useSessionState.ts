import { useState, type Dispatch, type SetStateAction } from 'react'

/** Each module retains its own period/filter selection across navigation. */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, update] = useState<T>(() => {
    try { const stored = sessionStorage.getItem(key); return stored ? JSON.parse(stored) as T : initial } catch { return initial }
  })
  const set: Dispatch<SetStateAction<T>> = next => update(previous => {
    const value = typeof next === 'function' ? (next as (v: T) => T)(previous) : next
    try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage can be unavailable in private browsing. */ }
    return value
  })
  return [value, set]
}
