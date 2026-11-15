import pandas as pd
import pytest

from app.domain.sources import PRODUCTS
from app.integrations.firms import NORMALIZED_COLUMNS, FirmsParseError, parse_firms_csv
from tests.fixtures import SYNTHETIC_MODIS_ARCHIVE, synthetic_modis_nrt_csv, synthetic_viirs_nrt_csv, utc_now

VIIRS = PRODUCTS["VIIRS_NOAA20_NRT"]
MODIS = PRODUCTS["MODIS_NRT"]


def test_viirs_nrt_normalizado():
    df = parse_firms_csv(synthetic_viirs_nrt_csv(utc_now()), VIIRS)
    assert list(df.columns) == NORMALIZED_COLUMNS
    assert len(df) == 4
    row = df.iloc[0]
    assert row["sensor"] == "VIIRS"
    assert row["satellite_name"] == "NOAA-20"
    assert row["confidence_class"] == "nominal"
    assert pd.isna(row["confidence_pct"])  # escala VIIRS não vira percentual
    assert row["bright_ti4_k"] == pytest.approx(330.1)
    assert pd.isna(row["brightness_k"])  # coluna MODIS vazia para VIIRS
    assert str(row["acq_datetime_utc"].tz) == "UTC"


def test_modis_preserva_confianca_percentual():
    df = parse_firms_csv(synthetic_modis_nrt_csv(utc_now()), MODIS)
    row = df.iloc[0]
    assert row["confidence_pct"] == 85
    assert row["confidence_class"] is None
    assert row["satellite_name"] == "Aqua"
    assert row["brightness_k"] == pytest.approx(320.5)


def test_arquivo_anual_com_tipo_e_instrumento():
    df = parse_firms_csv(SYNTHETIC_MODIS_ARCHIVE, PRODUCTS["MODIS_SP"])
    assert df["type"].tolist() == [0, 2]
    assert df["instrument"].tolist() == ["MODIS", "MODIS"]
    assert df["acq_time"].tolist() == ["1330", "0130"]


def test_classes_curtas_da_api_sao_mapeadas():
    csv = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"
        "-2.5,-54.9,330,0.4,0.5,2026-01-01,5,N21,h,2.0NRT,290,1.0,N\n"
        "-2.5,-54.8,330,0.4,0.5,2026-01-01,0405,N21,l,2.0NRT,290,1.0,N\n"
    )
    df = parse_firms_csv(csv, PRODUCTS["VIIRS_NOAA21_NRT"])
    assert df["confidence_class"].tolist() == ["high", "low"]
    assert df["acq_time"].iloc[0] == "0005"  # horário sem zeros à esquerda é completado


def test_texto_de_erro_com_http_200_e_rejeitado():
    with pytest.raises(FirmsParseError):
        parse_firms_csv("Invalid MAP_KEY.", VIIRS)


def test_colunas_obrigatorias_ausentes():
    with pytest.raises(FirmsParseError) as exc:
        parse_firms_csv("latitude,longitude,frp\n-2,-54,1\n", VIIRS)
    assert "acq_date" in str(exc.value.detail) or "acq_date" in exc.value.message


def test_csv_somente_cabecalho_retorna_vazio():
    header = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"
    df = parse_firms_csv(header, VIIRS)
    assert df.empty
    assert list(df.columns) == NORMALIZED_COLUMNS


def test_linhas_invalidas_sao_descartadas():
    csv = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n"
        "abc,-54.9,330,0.4,0.5,2026-01-01,0100,N20,n,2.0NRT,290,1.0,N\n"
        "-2.5,-54.9,330,0.4,0.5,data-ruim,0100,N20,n,2.0NRT,290,1.0,N\n"
        "-2.5,-54.9,330,0.4,0.5,2026-01-01,0100,N20,n,2.0NRT,290,,N\n"
    )
    df = parse_firms_csv(csv, VIIRS)
    assert len(df) == 1
    assert pd.isna(df["frp_mw"].iloc[0])  # FRP ausente fica nulo, não zero


def test_identificador_e_estavel():
    csv = synthetic_viirs_nrt_csv(utc_now())
    a = parse_firms_csv(csv, VIIRS)["detection_id"].tolist()
    b = parse_firms_csv(csv, VIIRS)["detection_id"].tolist()
    assert a == b
    assert len(set(a)) == len(a)
