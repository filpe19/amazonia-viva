import { CircleSlash, Eye, Landmark, Sigma, Telescope } from 'lucide-react'
import type { InfoKind } from '../lib/types'

// Selo único para o tipo de informação (D4). Ícone + texto: identidade nunca só por cor.
const KIND: Record<InfoKind, { label: string; cls: string; Icon: typeof Eye; title: string }> = {
  observacao: { label: "Observation", cls: 'bg-canopy-100 text-canopy-900', Icon: Eye, title: "Satellite observation, census or official register" },
  estimativa: { label: 'Estimate', cls: 'bg-river-soft text-[#104281]', Icon: Sigma, title: "Reanalysis or derived statistic" },
  previsao: { label: "Forecast", cls: 'bg-caution-soft text-caution', Icon: Telescope, title: "Future projection" },
  indicador_externo: { label: 'External indicator', cls: 'bg-[#ece8fb] text-[#3d2f8f]', Icon: Landmark, title: "External institution's product, shown without alteration" },
  ausente: { label: 'Unavailable', cls: 'bg-lichen-deep text-ink-2', Icon: CircleSlash, title: "Unavailable information or information requiring verification" },
}

export function KindBadge({ kind, compact = false }: { kind: InfoKind; compact?: boolean }) {
  const k = KIND[kind] ?? KIND.ausente
  return (
    <span title={k.title} className={`inline-flex shrink-0 items-center gap-1 rounded-full font-medium ${k.cls} ${compact ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]'}`}>
      <k.Icon className={compact ? 'size-3' : 'size-3.5'} aria-hidden="true" />
      {k.label}
    </span>
  )
}

export const KIND_ORDER: InfoKind[] = ['observacao', 'estimativa', 'previsao', 'indicador_externo', 'ausente']
