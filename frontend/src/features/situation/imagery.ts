// Data e resolução da cena de alta resolução (Esri World Imagery) no centro do mapa: a base não é imagem atual,
// e cada área tem sua própria data de captura. Consulta o serviço de metadados público da própria Esri.
import type * as maplibregl from 'maplibre-gl'
import { useEffect, useState } from 'react'

export interface ImageryInfo { state: 'idle' | 'loading' | 'ready' | 'lowres' | 'error'; date?: string; resolution_m?: number; provider?: string; sensor?: string }

const IDENTIFY = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify'

export function parseIdentify(json: unknown): ImageryInfo {
  const results = ((json as { results?: { layerName: string; attributes: Record<string, string> }[] })?.results ?? [])
    .filter((r) => /Resolution Metadata/.test(r.layerName) && r.attributes.SRC_DATE && r.attributes.SRC_DATE !== 'Null')
  if (!results.length) return { state: 'lowres' }
  const best = results.reduce((a, b) => (Number(b.attributes.SRC_RES) < Number(a.attributes.SRC_RES) ? b : a))
  const d = best.attributes.SRC_DATE // AAAAMMDD
  return { state: 'ready', date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, resolution_m: Number(best.attributes.SRC_RES),
    provider: best.attributes.NICE_DESC, sensor: best.attributes.SRC_DESC }
}

export function useImageryInfo(map: maplibregl.Map | null, enabled: boolean): ImageryInfo {
  const [info, setInfo] = useState<ImageryInfo>({ state: 'idle' })
  useEffect(() => {
    if (!map || !enabled) { setInfo({ state: 'idle' }); return }
    let timer = 0
    let ctrl: AbortController | null = null
    const run = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        if (map.getZoom() < 11) { setInfo({ state: 'lowres' }); return }
        ctrl?.abort()
        ctrl = new AbortController()
        const c = map.getCenter()
        const b = map.getBounds()
        const canvas = map.getCanvas()
        const params = new URLSearchParams({
          geometry: `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: 'all', tolerance: '1',
          mapExtent: `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`,
          imageDisplay: `${canvas.clientWidth},${canvas.clientHeight},96`, returnGeometry: 'false', f: 'json',
        })
        setInfo((cur) => ({ ...cur, state: 'loading' }))
        try {
          const res = await fetch(`${IDENTIFY}?${params}`, { signal: ctrl.signal })
          setInfo(parseIdentify(await res.json()))
        } catch (e) {
          if ((e as Error).name !== 'AbortError') setInfo({ state: 'error' })
        }
      }, 450)
    }
    run()
    map.on('moveend', run)
    return () => { window.clearTimeout(timer); ctrl?.abort(); map.off('moveend', run) }
  }, [map, enabled])
  return info
}
