import { useEffect, useId, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from './ui/button'
import { fmtDate } from '../lib/format'
import { t, useLocale } from '../lib/i18n'
import { validateDateRange } from '../lib/date-range'
export interface DateRange { start:string; end:string }
export function DateRangeControl({ label, value, onApply }: {label:string;value:DateRange;onApply:(range:DateRange)=>void}) {
  useLocale()
  const [draft,setDraft]=useState(value)
  useEffect(()=>setDraft(value),[value.start,value.end])
  const id=useId(),error=validateDateRange(draft.start,draft.end)
  const dirty=draft.start!==value.start||draft.end!==value.end
  return <form className="date-range-control" onSubmit={e=>{e.preventDefault();if(!error)onApply(draft)}}>
    <fieldset><legend><CalendarRange size={15} aria-hidden="true"/>{label}</legend>
      <div className="date-range-fields"><label>{t('From')}<input type="date" required value={draft.start} onChange={e=>setDraft(v=>({...v,start:e.target.value}))} aria-label={t('{0}: start',{'0':label})} aria-invalid={Boolean(error)} aria-describedby={id}/></label><span aria-hidden="true">—</span><label>{t('To')}<input type="date" required value={draft.end} onChange={e=>setDraft(v=>({...v,end:e.target.value}))} aria-label={t('{0}: end',{'0':label})} aria-invalid={Boolean(error)} aria-describedby={id}/></label></div>
      <p id={id} className={error?'date-range-error':'date-range-help'} aria-live="polite">{error?t(error):t('Complete UTC days. The end date is included.')}</p>
      <div className="date-range-applied"><p>{t('Applied period')}: <strong>{fmtDate(value.start)} – {fmtDate(value.end)}</strong></p><Button type="submit" variant={dirty?'default':'outline'} disabled={Boolean(error)||!dirty} aria-label={t('Apply {0}',{'0':label})}>{t('Apply period')}</Button></div>
    </fieldset>
  </form>
}
