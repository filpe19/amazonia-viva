import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, t } from './i18n'
import { fmt1, fmt2, fmtAgo, fmtCoord, fmtInt, fmtUtc, monthNames } from './format'
import { sourceCopy } from './sourceCopy'
import { productStyle } from './products'
import catalog from './messages.pt-BR.json'

afterEach(() => setLocale('en'))
describe('English and Brazilian Portuguese presentation', () => {
  it('keeps interpolation values and zero counts while changing the language', () => {
    setLocale('pt-BR')
    expect(getLocale()).toBe('pt-BR')
    expect(t('Median ({0} years)', { '0': 25 })).toBe('Mediana (25 anos)')
    expect(t('{0} of {1}', { '0': 0, '1': 5 })).toBe('0 de 5')
    expect(t('NASA_PRODUCT_ID')).toBe('NASA_PRODUCT_ID')
    setLocale('en')
    expect(t('Median ({0} years)', { '0': 25 })).toBe('Median (25 years)')
  })
  it('formats numbers, months and observation times without changing UTC', () => {
    setLocale('pt-BR')
    expect(fmtInt(12345)).toBe('12.345')
    expect(fmt1(15.9)).toBe('15,9')
    expect(fmt2(8.84)).toBe('8,84')
    expect(monthNames()[1]).toBe('fev')
    expect(fmtUtc('2026-02-01T00:30:00Z')).toBe('01 fev 2026 00:30 UTC')
    expect(fmtCoord(-1.2345,-50.6789)).toBe('1,2345° S, 50,6789° W')
    expect(fmtAgo('2026-02-01T00:30:00Z',new Date('2026-02-01T02:00:00Z'))).toBe('há 1 h 30 min')
    setLocale('en')
    expect(fmtInt(12345)).toBe('12,345')
    expect(fmt1(15.9)).toBe('15.9')
    expect(fmtUtc('2026-02-01T00:30:00Z')).toBe('01 Feb 2026 00:30 UTC')
  })
  it('preserves scientific product identity, resolution and source notes', () => {
    const note='Nuvens, fumaça densa, horário de passagem e geometria de visada reduzem ou impedem detecções; ausência de detecção não comprova ausência de fogo.'
    setLocale('pt-BR')
    expect(sourceCopy(note)).toBe(note)
    expect(productStyle('MODIS_SP')).toMatchObject({id:'MODIS_SP',label:'MODIS (arquivo)',sensor:'MODIS',resolution:'1 km'})
    setLocale('en')
    expect(sourceCopy(note)).toContain('No detections does not establish absence of fire')
    expect(productStyle('MODIS_SP')).toMatchObject({id:'MODIS_SP',label:'MODIS (archive)',sensor:'MODIS',resolution:'1 km'})
  })
  it('preserves every placeholder in the Portuguese scientific copy', () => {
    const placeholders=(text:string)=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort()
    for(const [key,value] of Object.entries(catalog)) {
      expect(value.trim(),key).not.toBe('')
      expect(placeholders(value),key).toEqual(placeholders(key))
    }
  })
})
