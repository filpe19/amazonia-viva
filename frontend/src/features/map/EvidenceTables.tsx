import { useMemo } from 'react'
import { DataTable, type DataColumn } from '../../components/DataTable'
import { t, useLocale } from '../../lib/i18n'
import { fmtInt, fmtUtc, shortHash } from '../../lib/format'
import { productStyle } from '../../lib/products'
import { sourceCopy } from '../../lib/sourceCopy'
import type { EvidenceManifest, ProductSummary } from '../../lib/types'

type SourceFile=EvidenceManifest['historical_sources'][number]
const fileKey=(f:SourceFile)=>`${f.product_id}:${f.year}`
const fileSearch=(f:SourceFile)=>[f.product_id,f.year,...f.version_values,f.sha256].join(' ')
const observationKey=(f:ProductSummary)=>f.product_id
const observationSearch=(f:ProductSummary)=>[f.product_id,productStyle(f.product_id).label,f.latest_observation_utc].join(' ')
export function EvidenceObservations({manifest}:{manifest:EvidenceManifest}) {
  const {locale}=useLocale()
  const columns=useMemo<DataColumn<ProductSummary>[]>(()=>[
    {id:'product',label:'Product',required:true,accessor:o=>o.product_id,cell:o=><span className="table-product"><i style={{background:productStyle(o.product_id).color}}/>{productStyle(o.product_id).label}</span>},
    {id:'count',label:'Detections',numeric:true,accessor:o=>o.available?o.count:null,cell:o=>o.available?fmtInt(o.count):'—'},
    {id:'observed',label:'Latest observation',unit:'UTC',accessor:o=>o.latest_observation_utc,cell:o=>fmtUtc(o.latest_observation_utc)},
    {id:'retrieved',label:'Retrieved',unit:'UTC',accessor:o=>o.provenance?.fetched_at,cell:o=><>{fmtUtc(o.provenance?.fetched_at)}{o.provenance?.stale&&<small>{t('(cached copy)')}</small>}</>},
    {id:'mode',label:'Mode',accessor:o=>o.provenance?.mode,cell:o=>o.provenance?.mode==='public_file'?t('public NRT archive'):o.provenance?.mode==='area_api'?t('area API'):'—'},
    {id:'version',label:'Version',accessor:o=>o.provenance?.versions.join(', ')},
    {id:'sha',label:'SHA-256',accessor:o=>o.provenance?.sha256,cell:o=><code title={o.provenance?.sha256}>{shortHash(o.provenance?.sha256)}</code>},
    {id:'source',label:'Source',sortable:false,accessor:o=>o.provenance?.request_urls.join(' '),cell:o=><>{o.provenance?.request_urls.map(u=><a key={u} href={u} target="_blank" rel="noreferrer">{u.split('/').at(-1)}</a>)}{o.error&&<span className="text-alert">{sourceCopy(o.error.message)}</span>}</>},
  ],[locale])
  return <DataTable id="evidence-observations" title={t('Observations and sources')} data={manifest.observations} columns={columns} getRowId={observationKey} searchText={observationSearch} initialHidden={['sha','mode']} description={t('Each row represents one satellite product. Source links and observation times remain available beside the count.')}/>
}
export function HistoricalSourceTable({files}:{files:SourceFile[]}) {
  const {locale}=useLocale()
  const columns=useMemo<DataColumn<SourceFile>[]>(()=>[
    {id:'product',label:'Product',required:true,accessor:f=>f.product_id,cell:f=><a href={f.url} target="_blank" rel="noreferrer">{productStyle(f.product_id).label}</a>},
    {id:'year',label:'Year',required:true,numeric:true,accessor:f=>f.year},
    {id:'version',label:'Version',accessor:f=>f.version_values.join(', ')},
    {id:'rows',label:'Rows read',numeric:true,accessor:f=>f.rows_read,cell:f=>fmtInt(f.rows_read)},
    {id:'imported',label:'Imported at',unit:'UTC',accessor:f=>f.imported_at,cell:f=>fmtUtc(f.imported_at)},
    {id:'sha',label:'SHA-256',accessor:f=>f.sha256,cell:f=><code title={f.sha256}>{shortHash(f.sha256)}</code>},
  ],[locale])
  return <DataTable id="historical-sources" title={t('Historical source files')} data={files} columns={columns} getRowId={fileKey} searchText={fileSearch} initialHidden={['sha']} description={t('Search by sensor, year, processing version or file hash. These are source files, not individual fire events.')}/>
}
