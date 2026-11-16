import { useId, useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import type { Region } from '../lib/types'
import { t, useLocale } from '../lib/i18n'
import { useRegions } from '../lib/hooks'
import { useRegion } from '../lib/region-context'

export interface SegOption<T extends string> { value: T; label: string; title?: string }

export function Segmented<T extends string>({ label, options, value, onChange, size = 'md' }: {
  label: string
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  useLocale()
  return (
    <div role="radiogroup" aria-label={t(label)} className="control inline-flex bg-lichen p-0.5 ring-1 ring-rule">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => {
              const index = options.findIndex(option => option.value === value)
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : ['ArrowRight','ArrowDown'].includes(e.key) ? (index + 1) % options.length : ['ArrowLeft','ArrowUp'].includes(e.key) ? (index - 1 + options.length) % options.length : null
              if (next == null) return
              e.preventDefault(); onChange(options[next].value)
              const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]')
              buttons?.[next]?.focus()
            }}
            title={o.title ? t(o.title) : undefined}
            onClick={() => onChange(o.value)}
            className={`control whitespace-nowrap ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-[13px]'} font-medium transition-colors ${
              active ? 'bg-surface text-ink shadow-sm ring-1 ring-rule' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {t(o.label)}
          </button>
        )
      })}
    </div>
  )
}

export function RegionSelect({ compact = false, onSelect }: { compact?: boolean; onSelect?: (id: string) => void }) {
  useLocale()
  const { region, setRegion } = useRegion()
  const q = useRegions()
  const regions = useMemo(() => [...(q.data?.regions ?? [])].sort((a,b) => Number(b.level!=='municipio')-Number(a.level!=='municipio') || Number(b.level==='bioma')-Number(a.level==='bioma') || Number(Boolean(b.pilot))-Number(Boolean(a.pilot)) || a.name.localeCompare(b.name,'pt-BR')), [q.data])
  const selected = regions.find(r=>r.id===region) ?? null
  const id = useId()
  return <div className="territory-picker">
    {!compact && <label htmlFor={id} className="type-label text-xs text-ink-2">{t('Territory')}</label>}
    <Combobox.Root items={regions} value={selected} isItemEqualToValue={(a,b)=>a.id===b.id}
      itemToStringLabel={item=>item.name} itemToStringValue={item=>item.id}
      onValueChange={item=>{if(item){setRegion(item.id);onSelect?.(item.id)}}}>
      <Combobox.InputGroup className="territory-input-group">
        <Search size={15} aria-hidden="true" />
        <Combobox.Input id={id} data-region-id={region} aria-label={t('Selected territory')} placeholder={q.isLoading?t('Loading territories…'):t('Search a municipality or state…')}
          className="territory-search-input" autoComplete="off" disabled={q.isLoading || q.isError} />
        <Combobox.Trigger className="territory-picker-trigger" aria-label={t('Show territories')}><ChevronsUpDown size={14} aria-hidden="true" /></Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal><Combobox.Positioner sideOffset={6} align="end" className="territory-positioner">
        <Combobox.Popup className="territory-popup">
          <p className="territory-picker-hint">{t('Type a municipality name. Accents are optional.')}</p>
          <Combobox.Empty className="territory-no-match">{t('No territory matches your search.')}</Combobox.Empty>
          <Combobox.List className="territory-options">{(item: Region)=><Combobox.Item key={item.id} data-region-id={item.id} value={item} className="territory-option">
            <span><strong>{item.name}</strong><small>{item.level==='municipio'?t('Municipality · Pará'):item.level==='bioma'?t('Amazon · 9 countries'):item.level==='estado'?t('State · Legal Amazon'):t('Country')}{item.pilot?` · ${t('Pilot territory')}`:''}</small></span>
            <Combobox.ItemIndicator><Check size={16} aria-hidden="true" /></Combobox.ItemIndicator>
          </Combobox.Item>}</Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner></Combobox.Portal>
    </Combobox.Root>
    {q.isError && <p role="alert" className="text-xs text-alert">{t('Territories could not be loaded.')}</p>}
  </div>
}

export function Toggle({ checked, onChange, label, swatch, disabled, hint }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  swatch?: string
  disabled?: boolean
  hint?: string
}) {
  useLocale()
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 py-1 text-[13px] ${disabled ? 'cursor-not-allowed opacity-50' : ''}`} title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-canopy-700"
      />
      {swatch && <span className="inline-block size-2.5 rounded-full ring-2 ring-white" style={{ background: swatch }} aria-hidden="true" />}
      <span className="text-ink">{t(label)}</span>
    </label>
  )
}
