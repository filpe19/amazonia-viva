import { t, useLocale } from '../lib/i18n'
import { Download, FlaskConical, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartFrame, ChartTooltipBox, axisProps, gridProps } from './charts'
import { AnomalyList } from './HistoryExtras'
import { Section } from './Page'
import { ErrorState, Loading } from './states'
import { apiUrl } from '../lib/api'
import { monthNames, fmt1, fmtInt, fmtNum, fmtYearMonth } from '../lib/format'
import { useHarmonized } from '../lib/hooks'
import type { HarmonizedRow } from '../lib/types'

const RAMP = ['#f9edd8', '#efd5a6', '#dfb875', '#bf8d40', '#99621c', '#694010']
const originLabel = (r?: HarmonizedRow) => r?.origin === 'observado_viirs' ? t("Observed data") : r?.origin === 'convertido_modis' ? t("Experimentally converted data") : t("Unavailable data")

function HarmonizedMatrix({ rows }: { rows: HarmonizedRow[] }) {
  useLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const years = useMemo(() => [...new Set(rows.map(r=>r.year))].sort(), [rows])
  const byKey = useMemo(() => new Map(rows.map(r=>[r.year_month,r])), [rows])
  const max = Math.max(1,...rows.map(r=>r.value??0))
  const item = selected ? byKey.get(selected) : undefined
  return <div className="harmonized-explorer">
    <div className="calendar-scroller" role="region" aria-label={t("Monthly calendar, scroll horizontally on smaller screens")} tabIndex={0}>
      <table className="harmonized-calendar" aria-label={t("Harmonized calendar in NOAA-20 equivalent detections")}>
        <thead><tr><th scope="col">{t("Year")}</th>{monthNames().map(m=><th scope="col" key={m}>{m}</th>)}</tr></thead>
        <tbody>{years.map(year=><tr key={year}><th scope="row">{year}</th>{monthNames().map((_,i)=>{
          const key=`${year}-${String(i+1).padStart(2,'0')}`
          const row=byKey.get(key)
          const value=row?.value
          const level=value == null ? -1 : value<=0 ? 0 : Math.min(5,Math.floor(Math.sqrt(value/max)*6))
          return <td key={key}><button type="button" className={`calendar-cell ${row?.origin ?? 'sem_dado'} ${selected===key?'selected':''}`} style={{backgroundColor:level<0?'#edf1ef':value===0?'#e4eae6':RAMP[level],color:level>=4?'#fff':'#233c30'}} aria-pressed={selected===key}
            aria-label={`${fmtYearMonth(key)}: ${value==null?t("unavailable"):fmtNum(value)+t(" equivalent detections")}; ${originLabel(row)}${row?.origin==='convertido_modis'?t("; empirical range {0} to {1}", {"0": fmtNum(row.low), "1": fmtNum(row.high)}):''}`}
            onClick={()=>setSelected(key)} onFocus={()=>setSelected(key)}>
            {value==null?'—':`${row?.origin==='convertido_modis'?'~':''}${value>=1000?fmt1(value/1000)+'k':fmtInt(value)}`}
          </button></td>
        })}</tr>)}</tbody>
      </table>
      <p className="calendar-scroll-hint">{t("Scroll to explore all months")}</p>
    </div>
    <aside className="calendar-inspector" aria-live="polite">
      <h3>{item?fmtYearMonth(item.year_month):t("Read the calendar")}</h3>
      {item ? <>
        <p className="inspector-origin">{originLabel(item)}</p>
        <p className="inspector-value">{item.value==null?'—':`${item.origin==='convertido_modis'?'~':''}${fmtInt(item.value)}`}</p>
        <p>{item.value==null?t("No observation or conversion is available for this month."):t("NOAA-20 equivalent detections")}</p>
        {item.origin==='convertido_modis'&&<><dl><dt>{t("MODIS Aqua observations")}</dt><dd>{fmtInt(item.modis_n)}</dd><dt>{t("Empirical P10–P90 range")}</dt><dd>{fmtInt(item.low)}–{fmtInt(item.high)}</dd></dl><p>{t("The observed MODIS count is multiplied by a fitted seasonal ratio. This is an estimate, not an additional satellite measurement.")}</p></>}
        {item.origin==='observado_viirs'&&<p>{t("Direct NOAA-20 VIIRS count. No conversion was applied. Equal range endpoints do not imply an error-free measurement.")}</p>}
      </> : <><p>{t("Select a month to inspect its origin, value and conversion range. Keyboard and touch are supported.")}</p><dl><dt>{t("Columns")}</dt><dd>{t("Calendar months, UTC")}</dd><dt>{t("Rows")}</dt><dd>{t("Years in the imported archive")}</dd><dt>{t("Color intensity")}</dt><dd>{t("Monthly activity, not fire severity")}</dd><dt>{t("Zero")}</dt><dd>{t("Zero detections in the imported data; different from unavailable")}</dd></dl></>}
      <p className="mt-4"><Info size={14} /> {t("A detection is not an individual fire.")}</p>
    </aside>
  </div>
}

export function HarmonizedSection({ region }: { region: string }) {
  useLocale()
  const q=useHarmonized(region)
  const [product,setProduct]=useState('VIIRS_NOAA20_SP')
  const [start,setStart]=useState('2024-08-01')
  const [end,setEnd]=useState('2024-11-30')
  const d=q.data
  const metric=d?.validation.summary?.sazonal
  const annual=(d?.annual??[]).map(a=>({...a,err:[a.value-a.low,a.high-a.value] as [number,number]}))
  return <Section id="harmonizado" title={t("A common view of fire activity")} description={t("Explore the monthly record in NOAA-20 equivalent detections. Earlier MODIS Aqua observations are experimentally converted; recent VIIRS observations retain their original counts.")}>
    <div className="experiment-notice"><FlaskConical size={20} /><div><strong>{t("Experimental harmonization")}</strong><p>{t("This is a comparison tool. It is not an operationally validated product or a reconstruction of individual fires.")}</p></div><span>{d?.first_month_with_data??'…'} — {d?.period?.[1]??'…'}</span></div>
    <div className="origin-legend" aria-label={t("Data origin legend")}>
      <span><i className="observed-key" />{t("Observed data")} <small>VIIRS NOAA-20</small></span>
      <span><i className="converted-key" />{t("Experimentally converted data")} <small>{t("MODIS Aqua · ~ estimate")}</small></span>
      <span><i className="unavailable-key" />{t("Unavailable data")} <small>—</small></span>
    </div>
    {q.isLoading?<Loading label={t("Loading the experimental calendar…")}/>:q.error?<ErrorState error={q.error} onRetry={()=>q.refetch()}/>:d&&<>
      <HarmonizedMatrix key={region} rows={d.series}/>
      <div className="conversion-validation">
        <div><h3>{t("How uncertain is the conversion?")}</h3><p>{t("Leave-one-year-out evaluation on active months in the overlap period. Errors are absolute percentages of the observed VIIRS count.")}</p></div>
        <div><strong>{metric?`${fmt1(metric.median_ape*100)}%`:'—'}</strong><span>{t("Median error")}</span></div>
        <div><strong>{metric?`${fmt1(metric.p90_ape*100)}%`:'—'}</strong><span>{t("90th percentile error")}</span></div>
        <div><strong>{metric?.n_months??'—'}</strong><span>{t("Active test months")}<br/>{d.validation.years[0]}–{d.validation.years.at(-1)}</span></div>
      </div>
      <p className="method-caveat">{t("The P90 is an error threshold exceeded by the worst 10% of evaluated months, not a 90% accuracy score. The evaluation uses ≥")}{d.validation.active_min??30} {t("detections in both products. Small-count months are not represented by these error statistics.")}</p>
      <details className="method-disclosure"><summary>{t("What does “equivalent detection” mean?")}</summary><div className="grid gap-5 md:grid-cols-2"><div><p>{t("A converted month is MODIS Aqua count × median VIIRS/MODIS ratio for that calendar month. The reference overlap is")} {d.overlap_years.join(', ')}{t("; ratio source:")} {d.ratio_source}.</p><p>{t("Seasonal ratios require at least three valid years and ≥10 detections in both sensors; otherwise the general ratio is used. This fitting rule differs from the active-month validation sample above.")}</p><p>{t("General ratio:")} {fmt1(d.ratios.global?.ratio)}×. P10–P90: {fmt1(d.ratios.global?.p10)}–{fmt1(d.ratios.global?.p90)}×.</p></div><div><h3>{t("Scientific limitations")}</h3><ul><li>{t("Past conversion assumes a stable relationship beyond the observed overlap; this has not been demonstrated.")}</li><li>{t("Aqua orbital drift and MODIS collection changes are not corrected.")}</li><li>{t("The P10–P90 band is empirical ratio spread, not a calibrated confidence or prediction interval.")}</li><li>{t("Individual converted months can have large errors. Sensor sensitivity, clouds and overpass timing remain relevant.")}</li><li>{t("The current year is not included in completed annual archives; recent activity has its own observation window.")}</li></ul></div></div></details>
      <div className="mt-6 grid gap-6 xl:grid-cols-2"><ChartFrame title={t("Annual equivalent detections")} subtitle={t("Bars: central value. Whiskers: summed empirical conversion ranges, not a calibrated annual confidence interval.")}><div className="h-[230px]"><ResponsiveContainer><ComposedChart data={annual} margin={{top:8,right:8,left:0,bottom:0}}><CartesianGrid {...gridProps}/><XAxis dataKey="year" {...axisProps} interval="preserveStartEnd"/><YAxis {...axisProps} width={55} tickFormatter={v=>fmtInt(v)}/><Tooltip content={({active,payload})=>{if(!active||!payload?.length)return null;const a=payload[0].payload as typeof annual[number];return <ChartTooltipBox title={String(a.year)} rows={[{label:'Equivalent detections',value:fmtInt(a.value)},{label:'Empirical range',value:a.converted_months?`${fmtInt(a.low)}–${fmtInt(a.high)}`:'Direct observations'},{label:'Converted months',value:String(a.converted_months)}]}/>}}/><Bar dataKey="value" fill="#b67c31" maxBarSize={20} isAnimationActive={false}><ErrorBar dataKey="err" width={4} stroke="#435d4d"/></Bar></ComposedChart></ResponsiveContainer></div></ChartFrame><div><h3 className="type-title mb-3 text-[15px]">{t("Unusual months in the experimental series")}</h3><AnomalyList anomalies={d.anomalies}/><p className="mt-3 text-xs text-ink-2">{t("Compared with the same calendar month in other years: P10/P90, |robust z| ≥1.5 and an absolute difference ≥10. Conversion uncertainty also affects this comparison.")}</p></div></div>
    </>}
    <div className="history-downloads"><div><h3>{t("Keep the evidence")}</h3><p>{t("Original records and the experimental series remain separate exports.")}</p></div><a className="button-primary" href={apiUrl('/history/harmonized.csv',{region})}><Download size={15}/>{t("Experimental series CSV")}</a>
      <details><summary className="button-secondary">{t("Export original observations")}</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label>{t("Product")}<select value={product} onChange={e=>setProduct(e.target.value)}><option value="VIIRS_NOAA20_SP">VIIRS NOAA-20</option><option value="MODIS_SP">{t("MODIS")}</option><option value="VIIRS_SNPP_SP">VIIRS S-NPP</option></select></label><label>{t("From")}<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>{t("To")}<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><a className="button-secondary" href={apiUrl('/history/export.csv',{region,product,start,end})}>{t("Download observations CSV")}</a></div></details>
    </div>
    <p className="mt-4 text-xs text-ink-2">{t("Source:")} <a className="underline" href="https://firms.modaps.eosdis.nasa.gov/download/" target="_blank" rel="noreferrer">{t("NASA FIRMS archive")}</a>{t(". Units: NOAA-20 equivalent detections per month. Neither count nor conversion measures burned area.")}</p>
  </Section>
}
