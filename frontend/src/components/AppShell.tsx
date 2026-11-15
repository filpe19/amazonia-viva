import { ArrowUpRight, BookOpen, CloudSun, FileSearch, History, Leaf, MapPinned, Radar } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useHealth } from '../lib/hooks'
import { RegionSelect } from './controls'
import { useRegion } from '../lib/region-context'

const NAV = [
  { to: '/', label: 'Current activity', short: 'Activity', description: 'Latest satellite observations', icon: Radar, end: true },
  { to: '/historico', label: 'Fire history', short: 'History', description: 'Records & experimental harmonization', icon: History },
  { to: '/territorio', label: 'Territory analysis', short: 'Territory', description: 'Environment & supporting evidence', icon: MapPinned },
]

export function AppShell({ children }: { children: ReactNode }) {
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
      <a href="#conteudo" className="skip-link">Skip to content</a>
      <aside className="app-sidebar print:hidden">
        <NavLink to="/" className="brand" aria-label="Amazônia Viva home">
          <span className="brand-mark"><Leaf size={26} strokeWidth={1.5} /></span>
          <span><strong>Amazônia Viva</strong><span>Environmental intelligence</span></span>
        </NavLink>
        <div className="sidebar-caption">Explore the evidence</div>
        <nav aria-label="Main navigation" className="primary-navigation">
          {NAV.map(({ to, label, short, description, icon: Icon, end }) => (
            <NavLink key={to} aria-label={label} to={`${to}?regiao=${region}`} end={end} className={({ isActive }) => `primary-link ${isActive ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              <span><strong className="desktop-nav-label">{label}</strong><strong className="mobile-nav-label">{short}</strong><small>{description}</small></span>
            </NavLink>
          ))}
        </nav>
        <nav className="secondary-navigation" aria-label="Supporting resources">
          <NavLink to={`/ambiente?regiao=${region}`}><CloudSun size={17} /> Environmental context</NavLink>
          <NavLink to={`/evidencias?regiao=${region}`}><FileSearch size={17} /> Evidence & exports</NavLink>
        </nav>
        <div className="sidebar-foot">
          <BookOpen size={19} strokeWidth={1.5} />
          <p>Evidence before decisions.<br /><span>Observations, context and uncertainty in one place.</span></p>
          <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS <ArrowUpRight size={13} /></a>
          <small>Independent research platform<br />NASA Space Apps Challenge 2026</small>
        </div>
      </aside>
      <div className="app-body">
        <header className="workspace-bar print:hidden">
          <div className="workspace-location"><span>Amazon basin</span><span className="workspace-divider">/</span><strong>{module?.label ?? (path.startsWith('/ficha') ? 'Territory report' : path === '/ambiente' ? 'Environmental context' : 'Evidence & exports')}</strong></div>
          <div className="shared-territory"><RegionSelect compact onSelect={selectRegion} /></div>
          <span className={`connection-state ${health.isError ? 'offline' : ''}`} role="status"><i />{health.isError ? 'Service unavailable' : health.isLoading ? 'Connecting' : 'Data service connected'}</span>
        </header>
        <main id="conteudo" className="workspace-main">{children}</main>
      </div>
    </div>
  )
}
