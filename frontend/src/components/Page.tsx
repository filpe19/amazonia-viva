import type { ReactNode } from 'react'

/** Moldura das páginas de conteúdo: título expandido + coluna de leitura. */
export function Page({ title, intro, aside, children }: { title: string; intro?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="content-page">
      <header className="page-heading">
        <div className="max-w-[68ch]">
          <h1 className="type-display text-[30px] text-canopy-900 sm:text-[34px]">{title}</h1>
          {intro && <div className="mt-2 text-[15px] leading-relaxed text-ink-2">{intro}</div>}
        </div>
        {aside && <div className="page-aside">{aside}</div>}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}

export function Section({ title, description, children, id, tone = 'panel' }: { title?: string; description?: ReactNode; children: ReactNode; id?: string; tone?: 'panel' | 'plain' }) {
  return (
    <section id={id} className={tone === 'panel' ? 'science-section' : 'science-section plain'} aria-labelledby={id && title ? `${id}-t` : undefined}>
      {title && (
        <div className="mb-4 max-w-[72ch]">
          <h2 id={id ? `${id}-t` : undefined} className="type-title text-xl text-ink">{title}</h2>
          {description && <div className="mt-1 text-sm leading-relaxed text-ink-2">{description}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
