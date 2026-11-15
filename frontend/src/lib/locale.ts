/** UI locale only: scientific identifiers, API payloads and exports stay unchanged. */
export type Locale = 'en' | 'pt-BR'
const KEY = 'amazonia-viva:language'
let locale: Locale = 'en'
try { if (typeof window !== 'undefined' && window.localStorage.getItem(KEY) === 'pt-BR') locale = 'pt-BR' } catch { /* Persistence is optional. */ }
const listeners = new Set<() => void>()
export const getLocale = () => locale
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.title = locale === 'pt-BR' ? 'Amazônia Viva — Inteligência ambiental' : 'Amazônia Viva — Environmental intelligence'
}
export function setLocale(value: Locale) {
  if (value !== 'en' && value !== 'pt-BR') return
  if (locale === value) return
  locale = value
  try { if (typeof window !== 'undefined') window.localStorage.setItem(KEY, value) } catch { /* The current session still works. */ }
  updateDocument()
  listeners.forEach(listener => listener())
}
updateDocument()
