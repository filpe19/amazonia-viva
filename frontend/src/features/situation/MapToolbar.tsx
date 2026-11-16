// Ferramentas de navegação do mapa: zoom, enquadramentos explícitos (nunca automáticos a cada atualização),
// troca de mapa-base e localização de coordenada.
import * as maplibregl from 'maplibre-gl'
import { Focus, House, LocateFixed, Map as MapIcon, Maximize2, Minus, PanelRightClose, PanelRightOpen, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t, useLocale } from '../../lib/i18n'
import { fmtCoord } from '../../lib/format'
import { framePadding, type Basemap } from '../map/DetectionMap'
import { municipalityAt, parseCoordinate } from './geo'
export { parseCoordinate }

type Bbox = [number, number, number, number]

export const BASEMAPS: { id: Basemap; label: string; note: string }[] = [
  { id: 'analytical', label: 'Analytical', note: 'Quiet background that lets observations stand out (OpenFreeMap Positron, OpenStreetMap data).' },
  { id: 'cartographic', label: 'Cartographic', note: 'Rivers, roads and populated places (OpenFreeMap Liberty, OpenStreetMap data).' },
  { id: 'imagery', label: 'High-resolution imagery', note: 'Esri World Imagery mosaic (Vantor/Maxar, Earthstar): houses, roads and clearings are visible where sub-metre scenes exist. Each area has its own capture date, shown on the map; it is not current imagery.' },
  { id: 'satellite', label: 'Satellite of the day', note: 'NASA GIBS daily VIIRS NOAA-20 true colour for the chosen date: smoke, clouds and orbit gaps are real; ~375 m, blurry when zoomed in.' },
]

export function MapToolbar({ map, regionBbox, stateBbox, detectionsBbox, basemap, setBasemap, imageryDate, setImageryDate, municipalities, expanded, setExpanded }: {
  map: maplibregl.Map | null
  regionBbox?: Bbox
  stateBbox?: Bbox
  detectionsBbox?: Bbox
  basemap: Basemap
  setBasemap: (b: Basemap) => void
  imageryDate: string
  setImageryDate: (d: string) => void
  municipalities?: GeoJSON.FeatureCollection
  expanded?: boolean
  setExpanded?: (v: boolean) => void
}) {
  useLocale()
  const [open, setOpen] = useState<'basemap' | 'locate' | null>(null)
  const [coord, setCoord] = useState('')
  const [coordError, setCoordError] = useState<string | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const frame = (b?: Bbox, maxZoom = 11) => { if (map && b) map.fitBounds(b, { padding: framePadding(map), duration: reduced ? 0 : 450, maxZoom }) }
  useEffect(() => () => { marker.current?.remove() }, [])

  const locate = () => {
    const p = parseCoordinate(coord)
    if (!p || !map) { setCoordError(t('Use decimal degrees as “latitude, longitude”, e.g. -2.44, -54.71')); return }
    setCoordError(null)
    const muni = municipalityAt(p[0], p[1], municipalities)
    marker.current?.remove()
    const el = document.createElement('div')
    el.className = 'locate-marker'
    marker.current = new maplibregl.Marker({ element: el })
      .setLngLat(p)
      .setPopup(new maplibregl.Popup({ offset: 14, className: 'mun-tip' }).setHTML(`<strong>${fmtCoord(p[1], p[0])}</strong><br>${muni ? `${t('Inside')} ${String(muni.properties?.name)} (IBGE)` : t('Outside the municipalities of Pará')}`))
      .addTo(map)
    marker.current.togglePopup()
    map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 10.5), duration: reduced ? 0 : 700 })
    setOpen(null)
  }

  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="map-tools" role="toolbar" aria-label={t('Map navigation')} aria-orientation="vertical">
      {setExpanded && <><button type="button" className="expand-btn" onClick={() => setExpanded(!expanded)} aria-pressed={expanded} title={expanded ? t('Show the side panel') : t('Expand the map')} aria-label={expanded ? t('Show the side panel') : t('Expand the map')}>{expanded ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}</button><span className="sep" /></>}
      <button type="button" onClick={() => map?.zoomIn()} title={t('Zoom in')} aria-label={t('Zoom in')}><Plus size={16} /></button>
      <button type="button" onClick={() => map?.zoomOut()} title={t('Zoom out')} aria-label={t('Zoom out')}><Minus size={16} /></button>
      <span className="sep" />
      <button type="button" onClick={() => frame(stateBbox, 7)} title={t('Reset view to Pará')} aria-label={t('Reset view to Pará')}><House size={16} /></button>
      <button type="button" onClick={() => frame(regionBbox)} disabled={!regionBbox} title={t('Frame the selected territory')} aria-label={t('Frame the selected territory')}><Focus size={16} /></button>
      <button type="button" onClick={() => frame(detectionsBbox, 12)} disabled={!detectionsBbox} title={t('Frame the filtered detections')} aria-label={t('Frame the filtered detections')}><Maximize2 size={16} /></button>
      <span className="sep" />
      <div className="tool-pop-wrap">
        <button type="button" aria-expanded={open === 'basemap'} onClick={() => setOpen(open === 'basemap' ? null : 'basemap')} title={t('Basemap')} aria-label={t('Basemap')}><MapIcon size={16} /></button>
        {open === 'basemap' && (
          <div className="tool-pop" role="dialog" aria-label={t('Basemap')}>
            <fieldset>
              <legend>{t('Basemap')}</legend>
              {BASEMAPS.map((b) => (
                <label key={b.id} className={basemap === b.id ? 'on' : ''}>
                  <input type="radio" name="basemap" value={b.id} checked={basemap === b.id} onChange={() => setBasemap(b.id)} />
                  <span><strong>{t(b.label)}</strong><small>{t(b.note)}</small></span>
                </label>
              ))}
            </fieldset>
            {basemap === 'satellite' && (
              <label className="date-field">{t('Imagery date (UTC)')}
                <input type="date" value={imageryDate} max={today} min="2018-01-01" onChange={(e) => e.target.value && setImageryDate(e.target.value)} />
              </label>
            )}
          </div>
        )}
      </div>
      <div className="tool-pop-wrap">
        <button type="button" aria-expanded={open === 'locate'} onClick={() => setOpen(open === 'locate' ? null : 'locate')} title={t('Locate a coordinate')} aria-label={t('Locate a coordinate')}><LocateFixed size={16} /></button>
        {open === 'locate' && (
          <form className="tool-pop" onSubmit={(e) => { e.preventDefault(); locate() }} aria-label={t('Locate a coordinate')}>
            <label htmlFor="locate-input">{t('Latitude, longitude (decimal degrees)')}</label>
            <div className="locate-row">
              <input id="locate-input" value={coord} onChange={(e) => setCoord(e.target.value)} placeholder="-2.4378, -54.7156" autoFocus inputMode="decimal" />
              <button type="submit">{t('Go')}</button>
            </div>
            {coordError && <p className="tool-error" role="alert">{coordError}</p>}
            {marker.current && <button type="button" className="link" onClick={() => { marker.current?.remove(); marker.current = null; setOpen(null) }}><X size={12} /> {t('Clear marker')}</button>}
          </form>
        )}
      </div>
    </div>
  )
}
