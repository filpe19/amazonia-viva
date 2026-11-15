import { getLocale } from './locale'
// Locale affects presentation only. All observation times remain explicitly UTC.
const formats = {
  en: [0, 1, 2].map(digits => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })),
  'pt-BR': [0, 1, 2].map(digits => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })),
}
const compactFormats = { en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }), 'pt-BR': new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }) }
export const fmtInt = (n: number | null | undefined) => n == null ? '—' : formats[getLocale()][0].format(n)
export const fmt1 = (n: number | null | undefined) => n == null ? '—' : formats[getLocale()][1].format(n)
export const fmt2 = (n: number | null | undefined) => n == null ? '—' : formats[getLocale()][2].format(n)
export const fmtNum = (n: number | null | undefined) => n == null ? '—' : compactFormats[getLocale()].format(n)
const SHORT = { en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], 'pt-BR': ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'] }
const LONG = { en: ['January','February','March','April','May','June','July','August','September','October','November','December'], 'pt-BR': ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'] }
export const monthNames = (length: 'short' | 'long' = 'short') => (length === 'long' ? LONG : SHORT)[getLocale()]
const pad = (n: number) => String(n).padStart(2, '0')
export function fmtUtc(iso: string | null | undefined, withYear = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getUTCDate())} ${monthNames()[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
/** Brasília UTC−3 is independent of interface language and viewer timezone. */
export function fmtBrt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (Brasília, UTC−3)`
}
export function fmtAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const ms = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const pt = getLocale() === 'pt-BR'
  if (ms < 0) return pt ? 'agora' : 'current'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return pt ? 'há menos de 1 min' : 'less than 1 min ago'
  if (min < 60) return pt ? `há ${min} min` : `${min} min ago`
  const h = Math.floor(min / 60), m = min % 60
  if (h < 48) return pt ? `há ${h} h${m ? ` ${m} min` : ''}` : `${h} h${m ? ` ${m} min` : ''} ago`
  const days = Math.floor(h / 24)
  return pt ? `há ${days} dias` : `${days} days ago`
}
export function fmtDate(isoDate: string | null | undefined, withYear = true): string {
  if (!isoDate) return '—'
  const [y,m,d] = isoDate.slice(0,10).split('-')
  return `${d} ${monthNames()[Number(m)-1]}${withYear ? ` ${y}` : ''}`
}
export function fmtYearMonth(ym: string): string {
  const [y,m] = ym.split('-')
  return `${monthNames()[Number(m)-1]}/${y.slice(2)}`
}
export function fmtCoord(lat: number, lon: number): string {
  const coordinate = (n: number) => Math.abs(n).toFixed(4).replace('.', getLocale() === 'pt-BR' ? ',' : '.')
  return `${coordinate(lat)}° ${lat < 0 ? 'S' : 'N'}, ${coordinate(lon)}° ${lon < 0 ? 'W' : 'E'}`
}
export function shortHash(h: string | null | undefined, n = 12): string { return h ? `${h.slice(0,n)}…` : '—' }
