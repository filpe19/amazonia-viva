import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode; label?: string; resetKey?: unknown }
interface State { error: Error | null }

/** Isola falhas de renderização: um componente quebrado não derruba a página inteira. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[render error${this.props.label ? `: ${this.props.label}` : ''}]`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex gap-2 rounded-[var(--radius-control)] bg-alert-soft p-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden="true" />
          <div>
            <p className="font-semibold">{this.props.label ? `${this.props.label}: could not display` : "This content could not be displayed"}</p>
            <p className="text-xs text-ink-2">{this.state.error.message}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
