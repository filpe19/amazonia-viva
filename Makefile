# Amazônia Viva — atalhos de desenvolvimento
PY ?= python3.11
VENV := backend/.venv
API_PORT ?= 8710
WEB_PORT ?= 5710

.PHONY: setup setup-api setup-web boundaries reference history-pilot api web test test-api test-web lint build smoke validate e2e

setup: setup-api setup-web boundaries reference ## instala tudo, limites do IBGE e setores censitários do Pará

setup-api:
	$(PY) -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -r backend/requirements-dev.txt
	@test -f backend/.env || cp backend/.env.example backend/.env

setup-web:
	cd frontend && npm install --no-fund --no-audit

boundaries: ## limites oficiais (IBGE, malha v3): Brasil, Pará, Santarém e os 144 municípios do Pará
	cd backend && .venv/bin/python -m scripts.fetch_boundaries

reference: ## setores censitários do Censo 2022 do Pará (IBGE, ~46 MB), para exposição potencial
	cd backend && .venv/bin/python -m scripts.fetch_reference

history-pilot: ## histórico piloto (~1,1 GB lidos em fluxo; ficam agregados + recorte do Pará em Parquet, ~40 MB)
	cd backend && .venv/bin/python -m scripts.import_history --product MODIS_SP --years 2016-2025 --skip-existing
	cd backend && .venv/bin/python -m scripts.import_history --product VIIRS_SNPP_SP --years 2023-2024 --skip-existing
	cd backend && .venv/bin/python -m scripts.import_history --product VIIRS_NOAA20_SP --years 2021-2025 --skip-existing

api: ## API em http://127.0.0.1:8710 (docs em /docs)
	cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $(API_PORT) --reload --reload-dir app

web: ## interface em http://127.0.0.1:5710
	cd frontend && npx vite --host 127.0.0.1 --port $(WEB_PORT)

test: test-api test-web

test-api:
	cd backend && .venv/bin/python -m pytest

test-web:
	cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run

lint:
	cd backend && .venv/bin/ruff check app scripts tests

build:
	cd frontend && npm run build

smoke: ## testa as integrações reais (rede): FIRMS, POWER, GIBS, IBGE, Censipam, CNES, OpenFreeMap
	cd backend && .venv/bin/python -m scripts.smoke_live

validate: ## confere os cálculos históricos de Portel contra o Parquet (API precisa estar rodando)
	cd backend && .venv/bin/python -m scripts.validate_history portel

e2e: ## fluxo completo no navegador: Portel no mapa → observações → histórico → ambiente → ficha
	cd frontend && npm run e2e
