import { useSyncExternalStore } from 'react'
import { getLocale, setLocale, subscribeLocale } from './locale'
import portuguese from './messages.pt-BR.json'
export { getLocale, setLocale }
export type { Locale } from './locale'
const messages: Record<string, string> = portuguese
/** English messages are stable keys; placeholders preserve all dynamic values. */
export function t(message: string, values: Record<string, string | number | null | undefined> = {}): string {
  const key = message.trim().replace(/\s+/g, ' ')
  const match = getLocale() === 'pt-BR' ? messages[key] : undefined
  const translated = match == null ? message : (message.match(/^\s*/)?.[0] ?? '') + match + (message.match(/\s*$/)?.[0] ?? '')
  return translated.replace(/\{([\w]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key] ?? '—') : match)
}
export function useLocale() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const)
  return { locale, setLocale, t }
}
