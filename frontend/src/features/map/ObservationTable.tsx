import { useMemo } from 'react'
import { DataTable, type DataColumn } from '../../components/DataTable'
import { t, useLocale } from '../../lib/i18n'
import { fmt2, fmtUtc, fmtCoord } from '../../lib/format'
import { productStyle } from '../../lib/products'
import type { DetectionsFC, DetectionProps } from '../../lib/types'

type Observation=DetectionsFC['features'][number]
const key=(f:Observation)=>`${f.properties.p}:${f.properties.id}`
const searchable=(f:Observation)=>[f.properties.p,f.properties.s,f.properties.t,...f.geometry.coordinates].join(' ')
export function ObservationTable({data,onSelect}:{data:DetectionsFC;onSelect:(point:DetectionProps)=>void}) {
  const {locale}=useLocale()
  const columns=useMemo<DataColumn<Observation>[]>(()=>[
    {id:'satellite',label:'Satellite',required:true,accessor:f=>f.properties.s,cell:f=><span className="table-product"><i style={{background:productStyle(f.properties.p).color}}/>{productStyle(f.properties.p).short}</span>},
    {id:'observed',label:'Observation (UTC)',required:true,accessor:f=>f.properties.t,cell:f=><button className="table-observation-link" onClick={()=>onSelect(f.properties)}>{fmtUtc(f.properties.t)}</button>},
    {id:'coordinates',label:'Coordinates',accessor:f=>f.geometry.coordinates.join(', '),cell:f=>fmtCoord(f.geometry.coordinates[1],f.geometry.coordinates[0])},
    {id:'frp',label:'FRP',unit:'MW',numeric:true,accessor:f=>f.properties.frp,cell:f=>fmt2(f.properties.frp)},
    {id:'confidence',label:'Confidence',unit:t('By sensor'),sortable:false,accessor:f=>f.properties.c,cell:f=>f.properties.p.startsWith('MODIS')?`${f.properties.c??'—'}%`:t({l:'low',n:'nominal',h:'high'}[String(f.properties.c)]??String(f.properties.c??'—'))},
    {id:'overpass',label:'Overpass',accessor:f=>f.properties.dn,cell:f=>t(f.properties.dn==='D'?'daytime':'nighttime')},
    {id:'product',label:'Product',accessor:f=>f.properties.p},
  ],[locale,onSelect])
  return <section className="science-section observation-table"><h2 className="type-title mb-2">{t('Explore the observations')}</h2><DataTable id="observations" title={t('Satellite detection records')} data={data.features} columns={columns} getRowId={key} searchText={searchable} initialHidden={['product']} description={t('Same territory, satellites and observation window as the map. Each row is a thermal pixel; repeated observations are not unique fires.')}/></section>
}
