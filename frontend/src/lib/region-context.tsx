import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

interface RegionCtx { region: string; setRegion: (region: string) => void }
const Ctx = createContext<RegionCtx | null>(null)
const KEY = 'amazonia-viva:territorio'

export function RegionProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const [stored, setStored] = useState(() => {
    try { return localStorage.getItem(KEY) ?? 'para' } catch { return 'para' }
  })
  const region = params.get('regiao') ?? stored
  useEffect(() => { setStored(region); try { localStorage.setItem(KEY, region) } catch { /* optional persistence */ } }, [region])
  const setRegion = useCallback((id: string) => {
    setStored(id)
    const next = new URLSearchParams(params)
    next.set('regiao', id)
    setParams(next, { replace: true })
  }, [params, setParams])
  const value = useMemo(() => ({ region, setRegion }), [region, setRegion])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRegion(): RegionCtx {
  const value = useContext(Ctx)
  if (!value) throw new Error('useRegion must be inside RegionProvider')
  return value
}
