import { t, useLocale } from '../lib/i18n'
import { ArrowUpRight, BookOpen, CloudSun, FileSearch, History, Leaf, MapPinned, Radar } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useHealth } from '../lib/hooks'
import { RegionSelect } from './controls'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useRegion } from '../lib/region-context'

const NAV = [
  { to: '/', label: 'Current activity', short: 'Activity', description: 'Latest satellite observations', icon: Radar, end: true },
  { to: '/historico', label: 'Fire history', short: 'History', description: 'Records & experimental harmonization', icon: History },
  { to: '/territorio', label: 'Territory analysis', short: 'Territory', description: 'Environment & supporting evidence', icon: MapPinned },
]

export function AppShell({ children }: { children: ReactNode }) {
  useLocale()
  const health = useHealth()
  const { region } = useRegion()
  const navigate = useNavigate()
  const location = useLocation()
  const selectRegion = (id: string) => {
    const params = new URLSearchParams(location.search)
    params.set('regiao', id)
    if (location.pathname === '/ambiente') { params.delete('lat'); params.delete('lon') }
    const path = location.pathname.startsWith('/ficha/') ? `/ficha/${id}` : location.pathname
    navigate(`${path}?${params.toString()}`, { replace: true })
  }
  const path = useLocation().pathname
  const module = NAV.find(n => n.to === '/' ? path === '/' : path.startsWith(n.to))
  return (
    <div className="app-shell">
      <a href="#conteudo" className="skip-link">{t("Skip to content")}</a>
      <aside className="app-sidebar print:hidden">
        <NavLink to="/" className="brand" aria-label={t("Amazônia Viva home")}>
          <span className="brand-mark"><Leaf size={26} strokeWidth={1.5} /></span>
          <span><strong>Amazônia Viva</strong><span>{t("Environmental intelligence")}</span></span>
        </NavLink>
        <div className="sidebar-caption">{t("Explore the evidence")}</div>
        <nav aria-label={t("Main navigation")} className="primary-navigation">
          {NAV.map(({ to, label, short, description, icon: Icon, end }) => (
            <NavLink key={to} aria-label={t(label)} to={`${to}?regiao=${region}`} end={end} className={({ isActive }) => `primary-link ${isActive ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              <span><strong className="desktop-nav-label">{t(label)}</strong><strong className="mobile-nav-label">{t(short)}</strong><small>{t(description)}</small></span>
            </NavLink>
          ))}
        </nav>
        <nav className="secondary-navigation" aria-label={t("Supporting resources")}>
          <NavLink to={`/ambiente?regiao=${region}`}><CloudSun size={17} /> {t("Environmental context")}</NavLink>
          <NavLink to={`/evidencias?regiao=${region}`}><FileSearch size={17} /> {t("Evidence & exports")}</NavLink>
        </nav>
        <div className="sidebar-foot">
          <BookOpen size={19} strokeWidth={1.5} />
          <p>{t("Evidence before decisions.")}<br /><span>{t("Observations, context and uncertainty in one place.")}</span></p>
          <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS <ArrowUpRight size={13} /></a>
          <small>{t("Independent research platform")}<br />NASA Space Apps Challenge 2026</small>
        </div>
      </aside>
      <div className="app-body">
        <header className="workspace-bar print:hidden">
          <div className="workspace-location"><span>{t("Amazon basin")}</span><span className="workspace-divider">/</span><strong>{t(module?.label ?? (path.startsWith('/ficha') ? "Territory report" : path === '/ambiente' ? "Environmental context" : "Evidence & exports"))}</strong></div>
          <div className="shared-territory"><RegionSelect compact onSelect={selectRegion} /></div>
          <LanguageSwitcher />
          <span className={`connection-state ${health.isError ? 'offline' : ''}`} role="status"><i />{health.isError ? t("Service unavailable") : health.isLoading ? t("Connecting") : t("Data service connected")}</span>
        </header>
        <main id="conteudo" className="workspace-main">{children}</main>
      </div>
    </div>
  )
}
