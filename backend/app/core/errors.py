"""Erros de domínio e de integração, com mapeamento para respostas HTTP."""

from __future__ import annotations


class AppError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, source: str | None = None, detail: dict | None = None):
        super().__init__(message)
        self.message = message
        self.source = source
        self.detail = detail or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ValidationAppError(AppError):
    status_code = 422
    code = "invalid_parameters"


class SourceNotConfiguredError(AppError):
    """Fonte que depende de credencial ausente (ex.: FIRMS MAP_KEY)."""

    status_code = 503
    code = "source_not_configured"


class UpstreamError(AppError):
    """Falha ao consultar uma fonte externa (rede, HTTP 5xx, resposta inválida)."""

    status_code = 502
    code = "upstream_error"


class UpstreamUnavailableError(UpstreamError):
    status_code = 503
    code = "upstream_unavailable"


class DataUnavailableError(AppError):
    """Os dados ainda não foram importados ou não existem para o recorte pedido."""

    status_code = 404
    code = "data_unavailable"
