"""Teste de fumaça das integrações REAIS (rede). Não usa dados sintéticos.

Uso (a partir de backend/):  python -m scripts.smoke_live
Imprime status, latência e uma evidência mínima de cada fonte; sai com código 1 se alguma falhar.
"""

from __future__ import annotations

import time

import httpx

UA = {"User-Agent": "AmazoniaViva/0.1 (NASA Space Apps 2026 research prototype)"}
PORTEL_BBOX_WFS = "-3.4950,-51.9396,-1.7476,-49.9086,urn:ogc:def:crs:EPSG::4674"

CHECKS = [
    ("NASA FIRMS — NRT NOAA-20 (7 dias)", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv",
     lambda r: r.text.split("\n", 1)[0].startswith("latitude") and r.text.count("\n") > 100),
    ("NASA FIRMS — NRT NOAA-21 (7 dias)", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv",
     lambda r: r.text.startswith("latitude")),
    ("NASA FIRMS — NRT MODIS (7 dias)", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_America_7d.csv",
     lambda r: r.text.startswith("latitude")),
    ("NASA POWER — diário (Portel)", "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=-50.96&latitude=-2.57&start=20261101&end=20261110&format=JSON",
     lambda r: "properties" in r.json()),
    ("NASA GIBS — VIIRS true color (tile)", "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-11-10/GoogleMapsCompatible_Level9/5/16/11.jpg",
     lambda r: r.headers.get("content-type", "").startswith("image/")),
    ("IBGE — população Censo 2022 (Portel)", "https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6%5B1505809%5D",
     lambda r: r.json()[0]["resultados"][0]["series"][0]["serie"]["2022"] == "62503"),
    ("IBGE — malha municipal (Portel)", "https://servicodados.ibge.gov.br/api/v3/malhas/municipios/1505809?formato=application/vnd.geo%2Bjson",
     lambda r: r.json()["type"] == "FeatureCollection"),
    ("IBGE — localidades BC250 2025 (WFS)", "https://geoservicos.ibge.gov.br/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json"
     f"&typeNames=CCAR:BC250_2025_lml_posic_geo_localidade_p&count=5&bbox={PORTEL_BBOX_WFS}", lambda r: len(r.json()["features"]) > 0),
    ("Censipam — API Painel do Fogo (ping)", "https://panorama.sipam.gov.br/painel-do-fogo/api/v1/diagnosticos/ping", lambda r: "pong" in r.text),
    ("Censipam — prioridades (bbox Portel)", "https://panorama.sipam.gov.br/painel-do-fogo/api/v1/eventos/prioridades?bbox=-51.9396,-3.4950,-49.9086,-1.7476",
     lambda r: isinstance(r.json(), list)),
    ("Censipam — WFS UCs federais (ICMBio)", "https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json"
     f"&typeNames=painel_do_fogo:icmbio_unidade_conservacao_federal&count=5&bbox={PORTEL_BBOX_WFS}", lambda r: "features" in r.json()),
    ("CNES — estabelecimentos (Portel)", "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_municipio=150580&limit=20&offset=0",
     lambda r: len(r.json()["estabelecimentos"]) > 0),
    ("OpenFreeMap — estilo do mapa", "https://tiles.openfreemap.org/styles/positron", lambda r: "layers" in r.json()),
]


def main() -> int:
    failures = 0
    with httpx.Client(timeout=60, follow_redirects=True, headers=UA) as c:
        for name, url, check in CHECKS:
            t0 = time.perf_counter()
            try:
                r = c.get(url)
                ok = r.status_code == 200 and bool(check(r))
                detail = f"HTTP {r.status_code}, {len(r.content):,} B"
            except Exception as exc:  # noqa: BLE001
                ok, detail = False, f"{type(exc).__name__}: {exc}"[:120]
            ms = int((time.perf_counter() - t0) * 1000)
            failures += 0 if ok else 1
            print(f"[{'ok' if ok else 'FALHA'}] {name:42s} {ms:6d} ms  {detail}")
    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} integrações reais respondendo como esperado.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
