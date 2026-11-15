import { t, useLocale } from '../lib/i18n'
import type { ReactNode } from 'react'

/** Moldura das páginas de conteúdo: título expandido + coluna de leitura. */
export function Page({ title, intro, aside, children }: { title: string; intro?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  useLocale()
  return (
    <div className="content-page">
      <header className="page-heading">
        <div className="max-w-[68ch]">
          <h1 className="type-display text-[30px] text-canopy-900 sm:text-[34px]">{t(title)}</h1>
          {intro && <div className="mt-2 text-[15px] leading-relaxed text-ink-2">{typeof intro === 'string' ? t(intro) : intro}</div>}
        </div>
        {aside && <div className="page-aside">{aside}</div>}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}

export function Section({ title, description, children, id, tone = 'panel' }: { title?: string; description?: ReactNode; children: ReactNode; id?: string; tone?: 'panel' | 'plain' }) {
  useLocale()
  return (
    <section id={id} className={tone === 'panel' ? 'science-section' : 'science-section plain'} aria-labelledby={id && title ? `${id}-t` : undefined}>
      {title && (
        <div className="mb-4 max-w-[72ch]">
          <h2 id={id ? `${id}-t` : undefined} className="type-title text-xl text-ink">{t(title)}</h2>
          {description && <div className="mt-1 text-sm leading-relaxed text-ink-2">{typeof description === 'string' ? t(description) : description}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
