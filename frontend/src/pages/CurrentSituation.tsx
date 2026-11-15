import { ChevronDown, Download, Info, Layers, MapPinned, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Segmented, Toggle } from '../components/controls'
import { OverpassRibbon } from '../components/OverpassRibbon'
import { ErrorState, Loading } from '../components/states'
import { DetectionDetail } from '../features/map/DetectionDetail'
import { DetectionMap, type Basemap, type MapLayers } from '../features/map/DetectionMap'
import { ProductSummaryList } from '../features/map/ProductSummaryList'
import { apiUrl } from '../lib/api'
import { fmtAgo, fmtUtc } from '../lib/format'
import { useBoundary, useDetections, useMunicipalities, useRegions } from '../lib/hooks'
import { DEFAULT_NRT, NRT_SELECTABLE, productStyle } from '../lib/products'
import { useRegion } from '../lib/region-context'
import { useSessionState } from '../lib/useSessionState'
import type { DayNight, DetectionProps, WindowLabel } from '../lib/types'

export default function CurrentSituation() {
  const { region, setRegion } = useRegion()
  const [win, setWin] = useSessionState<WindowLabel>('av:activity:window', '24h')
  const [daynight, setDaynight] = useSessionState<DayNight>('av:activity:daynight', 'all')
  const [products, setProducts] = useSessionState<string[]>('av:activity:products', DEFAULT_NRT)
  const [layers, setLayers] = useState<MapLayers>({ points: true, clusters: false, boundary: true, municipalities: true })
  const [basemap, setBasemap] = useState<Basemap>('mapa')
  const [imageryDate, setImageryDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10))
  const [selected, setSelected] = useState<DetectionProps | null>(null)
  const regions = useRegions()
  const regionInfo = regions.data?.regions.find(r => r.id === region)
  const boundary = useBoundary(region)
  const muni = useMunicipalities('para')
  const det = useDetections({ region, window: win, products, daynight })
  const data = det.isPlaceholderData ? undefined : det.data
  const meta = data?.metadata
  useEffect(() => setSelected(null), [region, win, daynight, products])
  const toggleProduct = (id: string, on: boolean) => setProducts(cur => on ? [...new Set([...cur, id])] : cur.filter(p => p !== id))
  const recent = [...(data?.features ?? [])].sort((a,b) => b.properties.t.localeCompare(a.properties.t)).slice(0, 3)

  return (
    <div className="activity-page">
      <header className="activity-heading">
        <div><h1 className="type-display">Latest satellite observations</h1>
          <p>Explore thermal detections in <strong>{regionInfo?.name ?? 'the selected territory'}</strong>. Each point is an observation at a satellite overpass.</p>
        </div>
        <Link to={`/territorio?regiao=${region}`} className="button-secondary"><MapPinned size={16} /> Analyse this territory</Link>
      </header>
      <section className="activity-workspace" aria-label="Current activity workspace">
        <div className="map-toolbar">
          <div className="toolbar-field"><span>Observation window</span>
            <Segmented label="Observation window" value={win} onChange={setWin} options={[{ value: '24h', label: '24 hours' },{ value: '48h', label: '48 hours' },{ value: '7d', label: '7 days' }]} />
          </div>
          <div className="toolbar-field"><span>Overpass</span>
            <Segmented label="Day or night" value={daynight} onChange={setDaynight} options={[{value:'all',label:'All'},{value:'D',label:'Day'},{value:'N',label:'Night'}]} />
          </div>
          <details name="map-filters" className="filter-disclosure" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}><summary><SlidersHorizontal size={16} /> Satellites <span className="filter-count">{products.length}</span><ChevronDown size={14} /></summary>
            <div className="filter-popover"><h3>Satellite observations</h3>
              {NRT_SELECTABLE.map(id => <Toggle key={id} checked={products.includes(id)} onChange={v => toggleProduct(id,v)} label={`${productStyle(id).label} · ${productStyle(id).resolution}`} swatch={productStyle(id).color} />)}
              <p>S-NPP observations ended on 2 Nov 2026. Its records remain in Fire history.</p>
            </div>
          </details>
          <details name="map-filters" className="filter-disclosure" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}><summary><Layers size={16} /> Layers <ChevronDown size={14} /></summary>
            <div className="filter-popover"><h3>Map layers</h3>
              <Toggle checked={layers.points} onChange={v => setLayers(l=>({...l,points:v,clusters:v?false:l.clusters}))} label="Individual detections" />
              <Toggle checked={layers.clusters} onChange={v => setLayers(l=>({...l,clusters:v,points:v?false:l.points}))} label="Geographic clusters" />
              <Toggle checked={layers.boundary} onChange={v => setLayers(l=>({...l,boundary:v}))} label="Selected boundary · IBGE" />
              <Toggle checked={layers.municipalities !== false} onChange={v => setLayers(l=>({...l,municipalities:v}))} label="Municipal boundaries · IBGE" />
              <div className="mt-3"><Segmented label="Basemap" value={basemap} onChange={setBasemap} options={[{value:'mapa',label:'Map'},{value:'imagem',label:'VIIRS imagery'}]} /></div>
              {basemap === 'imagem' && <label className="mt-3 block text-xs">Image date (UTC)<input aria-label="Image date" type="date" value={imageryDate} max={new Date().toISOString().slice(0,10)} onChange={e=>setImageryDate(e.target.value)} /></label>}
            </div>
          </details>
          <a aria-label="Export CSV" className="toolbar-export" aria-disabled={!products.length} href={products.length ? apiUrl('/detections/export.csv',{region,window:win,products:products.join(','),daynight}) : undefined}><Download size={16} /><span>Export CSV</span></a>
        </div>
        <div className="map-evidence-grid">
          <div className="map-stage">
            <DetectionMap data={data} boundary={boundary.data} bbox={regionInfo?.bbox} layers={layers} basemap={basemap} imageryDate={imageryDate} selectedId={selected?.id ?? null} onSelect={setSelected} municipalities={muni.data} selectedRegionId={region} onSelectRegion={id=>{setSelected(null);setRegion(id)}} />
            {det.isFetching && <div className="map-fetching"><Loading label="Updating satellite observations…" /></div>}
            <div className="map-legend" aria-label="Satellite legend">
              {products.map(id=><span key={id}><i style={{background:productStyle(id).color}} />{productStyle(id).short} <small>{productStyle(id).resolution}</small></span>)}
              <span className="legend-boundary"><i />IBGE boundary</span>
            </div>
          </div>
          <aside className="evidence-rail" aria-label="Observation details" aria-live="polite">
            {selected ? <DetectionDetail sel={selected} meta={meta} onClose={()=>setSelected(null)} /> : <>
              <div className="rail-heading"><h2>Observations by satellite</h2><p>Counts remain separate. The same fire can be observed more than once.</p></div>
              {!products.length ? <div className="empty-state"><Info size={22} /><h3>Select a satellite</h3><p>Open Satellites and select at least one product to load observations.</p></div> : det.error ? <ErrorState error={det.error} onRetry={()=>det.refetch()} /> : meta ? <ProductSummaryList meta={meta} /> : <Loading label="Loading satellite records…" />}
              {meta && !data?.features.length && <div className="empty-state"><h3>No detections in this window</h3><p>Try a longer period or a different satellite. Clouds and overpass timing can prevent detection.</p></div>}
              {!!recent.length && <div className="recent-observations"><h3>Inspect an observation</h3>{recent.map(f=><button key={f.properties.id} onClick={()=>setSelected(f.properties)}><span><i style={{background:productStyle(f.properties.p).color}} />{productStyle(f.properties.p).short}</span><small>{fmtUtc(f.properties.t)} <ChevronDown size={12} /></small></button>)}</div>}
            </>}
          </aside>
        </div>
        <div className="observation-clock">
          <div><span>Latest observation</span><strong>{fmtUtc(meta?.latest_observation_utc)}</strong><small>{meta?.latest_observation_utc ? fmtAgo(meta.latest_observation_utc) : 'Waiting for data'}</small></div>
          <div><span>Platform synchronization</span><strong>{fmtUtc(meta?.platform_data_fetched_at)}</strong><small>Time records were collected from FIRMS</small></div>
          <div><span>Nominal source latency</span><strong>Up to ~3 hours</strong><small>Declared by NASA FIRMS; not continuous observation</small></div>
        </div>
      </section>
      <div className="scientific-caption"><Info size={16} /><p>A detection is a thermal-anomaly pixel, not an individual fire or a burned-area measurement. No detection does not establish that no fire occurred. <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">Source: NASA FIRMS</a></p></div>
      <details className="timeline-section"><summary>Satellite observation timeline <ChevronDown size={16} /></summary><div>{meta && products.length ? <OverpassRibbon data={data} products={products} /> : <p>No observations to display.</p>}</div></details>
    </div>
  )
}
