import { t, useLocale } from './lib/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Loading } from './components/states'
import { ApiError } from './lib/api'
import { RegionProvider } from './lib/region-context'
import CurrentSituation from './pages/CurrentSituation'
import './styles.css'

const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const EnvironmentPage = lazy(() => import('./pages/EnvironmentPage'))
const TerritoryPage = lazy(() => import('./pages/TerritoryPage'))
const EvidencePage = lazy(() => import('./pages/EvidencePage'))
const FichaPage = lazy(() => import('./pages/FichaPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

function NotFound() {
  useLocale()
  return <div className="p-8 text-ink-2">{t("Page not found.")}</div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RegionProvider>
          <AppShell>
            <ErrorBoundary label="Section">
            <Suspense fallback={<Loading className="p-8" label="Loading section…" />}>
              <Routes>
                <Route path="/" element={<CurrentSituation />} />
                <Route path="/historico" element={<HistoryPage />} />
                <Route path="/ambiente" element={<EnvironmentPage />} />
                <Route path="/territorio" element={<TerritoryPage />} />
                <Route path="/evidencias" element={<EvidencePage />} />
                <Route path="/ficha/:regionId" element={<FichaPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </AppShell>
        </RegionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
