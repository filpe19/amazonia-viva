"""Verificação de consistência (veracidade) dos números exibidos, contra a API em execução e as fontes oficiais.

Uso (a partir de backend/, com a API em :8710):  python -m scripts.verify_consistency [santarem portel para]
Gera um relatório Markdown em stdout. Cada verificação compara duas rotas independentes ou uma rota com a fonte oficial.
"""

from __future__ import annotations

import gzip
import json
import sys
import urllib.request
from collections import Counter

API = "http://127.0.0.1:8710/api/v1"
SIDRA_9719 = ("https://servicodados.ibge.gov.br/api/v3/agregados/9719/periodos/2022/variaveis/1432"
              "?localidades=N131%5Ball%5D&classificacao=1714%5B60024%5D")


def get(path: str, timeout: int = 900):
    url = path if path.startswith("http") else f"{API}{path}"
    req = urllib.request.Request(url, headers={"Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        if body[:2] == b"\x1f\x8b":  # alguns servidores enviam gzip mesmo sem pedido
            body = gzip.decompress(body)
        return json.loads(body)


def main(regions: list[str]) -> int:
    rows: list[tuple[str, str, bool, str]] = []

    def check(region: str, name: str, ok: bool, detail: str) -> None:
        rows.append((region, name, ok, detail))

    for region in regions:
        win = "7d"
        det = get(f"/detections?region={region}&window={win}&products=VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT")
        n_det = len(det["features"])
        meta_counts = {p["product_id"]: p["count"] for p in det["metadata"]["products"]}
        check(region, "Detecções: GeoJSON = soma dos metadados por produto", n_det == sum(meta_counts.values()),
              f"{n_det} feições; metadados {meta_counts}")
        by_sat_geo = Counter(f["properties"]["s"] for f in det["features"])
        by_sat_meta = Counter()
        for p in det["metadata"]["products"]:
            by_sat_meta.update(p.get("by_satellite") or {})
        check(region, "Detecções por satélite: mapa = metadados", dict(by_sat_geo) == dict(by_sat_meta), f"{dict(by_sat_geo)}")

        hs = get(f"/territory/{region}/hotspots?window={win}")
        if hs.get("available"):
            same = hs["summary"]["detections"] == n_det
            t_hs, t_det = hs["generated_at"], det["metadata"]["generated_at"]
            # Janela móvel de 7 dias: cálculos em horários diferentes podem diferir por detecções que saíram/entraram na janela.
            drift_ok = not same and t_hs != t_det and abs(hs["summary"]["detections"] - n_det) <= max(5, 0.001 * n_det)
            check(region, "Focos: detecções agrupadas = detecções do mapa", same or drift_ok,
                  f"{hs['summary']['detections']} agrupadas ({t_hs}) × {n_det} no mapa ({t_det})"
                  + ("; diferença explicada pela janela móvel de 7 dias entre os dois horários (cache de até 30 min)" if drift_ok else ""))
            bad = [i["id"] for i in hs["items"] if sum(i["proportion"]["by_satellite"].values()) != i["proportion"]["pixels"]]
            check(region, "Focos: pixels = soma por satélite (sem dupla contagem)", not bad, f"{len(hs['items'])} focos listados; divergentes: {bad[:3]}")
            def rule_ok(i):
                ids = {r["id"] for r in i["level_reasons"]}
                if i["level"] == "alto":
                    return i["proportion"]["overpasses"] >= 2 and bool(ids & {"inside", "close_people", "downwind"})
                return True
            wrong = [i["id"] for i in hs["items"] if not rule_ok(i)]
            check(region, "Grau 'alto' só com regra atendida (≥ 2 passagens + alvo)", not wrong, f"{hs['summary']['by_level']}; fora da regra: {wrong[:3]}")
            dw = [t for i in hs["items"] for t in i["targets"]["downwind"]]
            check(region, "'A favor do vento' só com vento de modelo disponível e ≤ 20 km", all(t["km"] <= 20 for t in dw)
                  and all(i["wind"] for i in hs["items"] if i["targets"]["downwind"]), f"{len(dw)} alvos a favor do vento")
            check(region, "Probabilidade de chegada não é calculada (declarada como não modelada)",
                  "probability" not in json.dumps(hs).lower() and "Probabilidade" in hs["not_modeled"][0], "ok")
        ind = get(f"/territory/{region}/indigenous?window={win}")
        if ind.get("available"):
            inside = [i for i in ind["items"] if i["alert"] != "surroundings"]
            conf = all(i["inside"]["overpasses"] >= 2 for i in ind["items"] if i["alert"] == "inside_confirmed")
            check(region, "TI 'fogo dentro confirmado' só com ≥ 2 passagens", conf, f"{len(inside)} TIs com fogo dentro")
            pops = [i["population"]["indigenous"] for i in inside if i.get("population")]
            check(region, "Residentes indígenas (soma) = soma das TIs listadas", (sum(pops) if pops else None) ==
                  ind["summary"]["indigenous_residents_in_lands_with_fire_inside"], f"{sum(pops) if pops else '—'}")
        if region not in ("para", "amazonia"):
            att = get(f"/territory/{region}/attention?window={win}")
            lay = get(f"/territory/{region}/deter")
            if att.get("available") and att["sources"].get("deter", {}).get("available"):
                check(region, "DETER: polígonos cruzados = polígonos da camada do mapa", att["sources"]["deter"]["features"] == len(lay["features"]),
                      f"{att['sources']['deter']['features']} × {len(lay['features'])}")
    # fonte oficial: residentes indígenas em TIs na Amazônia Legal (SIDRA 9719, N131)
    try:
        sidra = get(SIDRA_9719, timeout=90)
        total = int(sidra[0]["resultados"][0]["series"][0]["serie"]["2022"])
        amz = get("/territory/amazonia/indigenous?window=7d")
        sub = amz["summary"]["indigenous_residents_in_lands_with_fire_inside"] or 0
        check("amazonia", "Residentes em TIs com fogo ≤ total oficial da Amazônia Legal (IBGE 9719)", sub <= total,
              f"{sub:,} de {total:,} ({100 * sub / total:.0f}%)".replace(",", "."))
    except Exception as exc:  # noqa: BLE001
        check("amazonia", "Comparação com o total oficial do IBGE", False, f"não verificado: {exc}")

    print("| Região | Verificação | Resultado | Detalhe |\n|---|---|---|---|")
    for r, name, ok, detail in rows:
        print(f"| {r} | {name} | {'✅ ok' if ok else '❌ divergente'} | {detail} |")
    print(f"\n{sum(1 for x in rows if x[2])} de {len(rows)} verificações consistentes.")
    return 0 if all(x[2] for x in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:] or ["santarem", "portel", "para"]))
