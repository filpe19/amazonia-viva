// Sobre a plataforma: o que é, fontes e licenças, regras, limitações, acessibilidade e uso de IA.
import { ExternalLink } from 'lucide-react'
import { Page, Section } from '../components/Page'
import { t, useLocale } from '../lib/i18n'

const SOURCES: [string, string, string, string][] = [
  ['NASA FIRMS', 'Thermal detections VIIRS (NOAA-20, NOAA-21) and MODIS (Terra, Aqua): near real time and standard-processing archive', 'Open NASA data', 'https://firms.modaps.eosdis.nasa.gov/'],
  ['IBGE', 'Boundaries (mesh v3), localities and seats (BC250 2025), 2022 Census (population, Indigenous residents by land, census tracts)', 'Open public data', 'https://www.ibge.gov.br/'],
  ['FUNAI · ICMBio · MMA/CNUC · INCRA', 'Indigenous lands, conservation units, quilombola territories and settlements (via Censipam GeoServer)', 'Public official data', 'https://panorama.sipam.gov.br/'],
  ['Censipam', 'Fire events (Painel do Fogo), registered brigades, federal roads (DNIT) mirror, ACTO/OTCA Amazon layers', 'Public API and GeoServer', 'https://panorama.sipam.gov.br/painel-do-fogo/'],
  ['INPE — DETER', 'Deforestation, degradation, mining and forest fire scar warnings (TerraBrasilis)', 'Public WFS', 'https://terrabrasilis.dpi.inpe.br/'],
  ['ANM — SIGMINE', 'Active mining titles and garimpo reserves', 'Public ArcGIS service', 'https://geo.anm.gov.br/'],
  ['CNES — Ministry of Health', 'Health facilities with coordinates', 'Open data API', 'https://apidadosabertos.saude.gov.br/'],
  ['NASA POWER', 'Weather reanalysis (temperature, humidity, rain, wind) and 2001–2025 climatology', 'Open NASA data', 'https://power.larc.nasa.gov/'],
  ['Copernicus GWIS', 'Fire Weather Index (FWI) map layer', 'Copernicus open licence', 'https://gwis.jrc.ec.europa.eu/'],
  ['Open-Meteo', 'Model wind (ECMWF, GFS, ICON) for downwind screening', 'CC BY 4.0, non-commercial use', 'https://open-meteo.com/'],
  ['NASA GIBS · Esri World Imagery · OpenFreeMap', 'Daily satellite imagery, high-resolution mosaic and OpenStreetMap basemaps', 'Each provider’s terms (Esri requires a key for public use)', 'https://www.openstreetmap.org/copyright'],
]

export default function AboutPage() {
  useLocale()
  return (
    <Page title={t('About Amazônia Viva')} intro={t('An environmental intelligence platform that turns public satellite and territorial data into transparent fire alerts for the Amazon, to support prevention and humanitarian decisions.')}>
      <Section title={t('What the platform does')}>
        <ul className="about-list">
          <li>{t('Harmonizes VIIRS and MODIS thermal detections without adding sensors together: comparisons stay within the same instrument, and shares normalise each sensor by its own total.')}</li>
          <li>{t('Groups detections into hotspots and shows what lies in the way — cities, localities, federal roads, Indigenous lands and protected areas — with model wind and public alert rules.')}</li>
          <li>{t('Gives Indigenous lands their own alerts with residents (2022 Census), peoples, the responsible FUNAI unit, access and evidence of mining or deforestation.')}</li>
          <li>{t('Lets researchers compare the same period with past years using the FIRMS archive (Pará).')}</li>
        </ul>
      </Section>
      <Section title={t('Data sources and licences')}>
        <div className="overflow-x-auto"><table className="compare-table about-sources">
          <thead><tr><th>{t('Source')}</th><th>{t('Used for')}</th><th>{t('Licence / terms')}</th><th /></tr></thead>
          <tbody>{SOURCES.map(([n, use, lic, url]) => (
            <tr key={n}><th scope="row">{n}</th><td>{t(use)}</td><td>{t(lic)}</td><td><a href={url} target="_blank" rel="noreferrer" aria-label={`${n} (${t('opens in a new tab')})`}><ExternalLink size={14} aria-hidden="true" /></a></td></tr>
          ))}</tbody>
        </table></div>
      </Section>
      <Section title={t('Rules and limitations')}>
        <ul className="about-list">
          <li>{t('A detection is a thermal-anomaly pixel at one overpass, not an individual fire, a perimeter or burned area. No detection does not establish that no fire occurred.')}</li>
          <li>{t('Alerts, levels and reliability follow published rules; they are screening tools, not official alerts, and they do not measure damage.')}</li>
          <li>{t('The probability of fire reaching a place is not modelled: that requires a calibrated spread model. The platform shows distance, direction, model wind and history instead.')}</li>
          <li>{t('Population figures are residents of a territory (2022 Census), never estimates of people affected.')}</li>
          <li>{t('Unavailable sources are always shown as unavailable, never as zero.')}</li>
        </ul>
      </Section>
      <Section title={t('Accessibility')}>
        <p className="about-text">{t('Tested against WCAG 2.1 level AA with automated audits (0 violations on the main screens), keyboard navigation and visible focus. Interface in Portuguese and English.')}</p>
      </Section>
      <Section title={t('Use of artificial intelligence')}>
        <p className="about-text">{t('AI coding assistants were used to help write and test the software. All data comes from the official sources listed above, and every alert rule is explicit and reproducible; no AI model generates, estimates or classifies the data shown.')}</p>
      </Section>
      <Section title={t('Source code')}>
        <p className="about-text"><a className="text-river underline" href="https://github.com/filpe19/amazonia-viva" target="_blank" rel="noreferrer">github.com/filpe19/amazonia-viva</a> · {t('NASA Space Apps Challenge 2026 — Harmonization of MODIS and VIIRS Hot Spots.')}</p>
      </Section>
    </Page>
  )
}
