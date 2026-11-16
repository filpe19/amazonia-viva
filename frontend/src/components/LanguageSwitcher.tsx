import { t, useLocale } from '../lib/i18n'

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  return (
    <fieldset className="language-switcher" aria-label={t('Language')}>
      <legend className="sr-only">{t('Language')}</legend>
      <button type="button" lang="pt-BR" aria-label="PT-BR, Português (Brasil)" title="Português (Brasil)"
        aria-pressed={locale === 'pt-BR'} onClick={() => setLocale('pt-BR')}>PT-BR</button>
      <button type="button" lang="en" aria-label="EN, English" title="English"
        aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
    </fieldset>
  )
}
