"""Catálogo dos produtos de detecção de calor da NASA FIRMS usados pela plataforma.

Os nomes de produto seguem exatamente a API de área do FIRMS
(https://firms.modaps.eosdis.nasa.gov/api/area/). As diferenças entre sensores
(resolução, sensibilidade, escala de confiança) são preservadas: cada produto é
tratado como uma série distinta.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Sensor = Literal["VIIRS", "MODIS"]
Processing = Literal["NRT", "SP"]

FIRMS_NOMINAL_LATENCY = "<3 horas após a observação (dados globais NRT, FIRMS FAQ)"
FIRMS_LATENCY_SOURCE = "https://www.earthdata.nasa.gov/data/tools/firms/faq"


@dataclass(frozen=True)
class FirmsProduct:
    id: str
    sensor: Sensor
    platform: str
    processing: Processing
    collection: str
    resolution_m: int
    confidence_scale: str
    public_file_dir: str | None = None
    public_file_prefix: str | None = None
    archive_country_dir: str | None = None
    status: Literal["ativo", "encerrado"] = "ativo"
    status_note: str | None = None
    default_nrt: bool = False

    def public_file_url(self, base_url: str, region: str = "South_America", period: str = "7d") -> str | None:
        if not (self.public_file_dir and self.public_file_prefix):
            return None
        return (
            f"{base_url}/data/active_fire/{self.public_file_dir}/csv/"
            f"{self.public_file_prefix}_{region}_{period}.csv"
        )

    def archive_country_url(self, base_url: str, year: int, country: str = "Brazil") -> str | None:
        if not self.archive_country_dir:
            return None
        d = self.archive_country_dir
        return f"{base_url}/data/country/{d}/{year}/{d}_{year}_{country}.csv"

    def to_dict(self) -> dict:
        return asdict(self)


VIIRS_CONF = "Classes low / nominal / high (VIIRS 375 m)"
MODIS_CONF = "Percentual 0–100 (MODIS 1 km)"
SNPP_END = "Produção encerrada em 02/11/2026 às 15:40 UTC (FIRMS FAQ). Mantido como série histórica."

PRODUCTS: dict[str, FirmsProduct] = {
    p.id: p
    for p in [
        FirmsProduct(
            id="VIIRS_NOAA20_NRT", sensor="VIIRS", platform="NOAA-20", processing="NRT",
            collection="C2", resolution_m=375, confidence_scale=VIIRS_CONF,
            public_file_dir="noaa-20-viirs-c2", public_file_prefix="J1_VIIRS_C2", default_nrt=True,
        ),
        FirmsProduct(
            id="VIIRS_NOAA21_NRT", sensor="VIIRS", platform="NOAA-21", processing="NRT",
            collection="C2", resolution_m=375, confidence_scale=VIIRS_CONF,
            public_file_dir="noaa-21-viirs-c2", public_file_prefix="J2_VIIRS_C2", default_nrt=True,
        ),
        FirmsProduct(
            id="MODIS_NRT", sensor="MODIS", platform="Terra/Aqua", processing="NRT",
            collection="C6.1", resolution_m=1000, confidence_scale=MODIS_CONF,
            public_file_dir="modis-c6.1", public_file_prefix="MODIS_C6_1",
        ),
        FirmsProduct(
            id="VIIRS_SNPP_NRT", sensor="VIIRS", platform="Suomi NPP", processing="NRT",
            collection="C2", resolution_m=375, confidence_scale=VIIRS_CONF,
            public_file_dir="suomi-npp-viirs-c2", public_file_prefix="SUOMI_VIIRS_C2",
            status="encerrado", status_note=SNPP_END,
        ),
        FirmsProduct(
            id="MODIS_SP", sensor="MODIS", platform="Terra/Aqua", processing="SP",
            collection="C6.1", resolution_m=1000, confidence_scale=MODIS_CONF,
            archive_country_dir="modis",
        ),
        FirmsProduct(
            id="VIIRS_SNPP_SP", sensor="VIIRS", platform="Suomi NPP", processing="SP",
            collection="C2", resolution_m=375, confidence_scale=VIIRS_CONF,
            archive_country_dir="viirs-snpp", status="encerrado", status_note=SNPP_END,
        ),
        FirmsProduct(
            id="VIIRS_NOAA20_SP", sensor="VIIRS", platform="NOAA-20", processing="SP",
            collection="C2", resolution_m=375, confidence_scale=VIIRS_CONF,
            archive_country_dir="viirs-jpss1",
        ),
    ]
}

NRT_PRODUCTS = [p for p in PRODUCTS.values() if p.processing == "NRT"]
DEFAULT_NRT_PRODUCTS = [p.id for p in PRODUCTS.values() if p.default_nrt]

# Códigos de satélite encontrados nos CSVs (NRT e arquivo anual) -> nome.
SATELLITE_NAMES: dict[str, str] = {
    "N20": "NOAA-20", "1": "NOAA-20", "J1": "NOAA-20",
    "N21": "NOAA-21", "J2": "NOAA-21",
    "N": "Suomi NPP", "NPP": "Suomi NPP",
    "T": "Terra", "TERRA": "Terra",
    "A": "Aqua", "AQUA": "Aqua",
}


def satellite_name(code: str) -> str:
    return SATELLITE_NAMES.get(str(code).strip().upper(), str(code).strip())


def get_product(product_id: str) -> FirmsProduct:
    try:
        return PRODUCTS[product_id]
    except KeyError as exc:
        from app.core.errors import ValidationAppError

        raise ValidationAppError(
            f"Produto FIRMS desconhecido: {product_id}", detail={"validos": sorted(PRODUCTS)}
        ) from exc
