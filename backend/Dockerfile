# API Amazônia Viva (FastAPI). Dados de execução (cache, histórico, arquivo FIRMS, referências) ficam no volume /app/data/runtime.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY data/boundaries ./data/boundaries
RUN useradd --create-home --uid 10001 av && mkdir -p /app/data/runtime && chown -R av:av /app
USER av
EXPOSE 8710
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8710/api/v1/health', timeout=8).status == 200 else 1)"
# Um processo: os cálculos pesados ficam numa fila única (app/core/heavy.py) e o cache em memória é compartilhado.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8710", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "15"]
