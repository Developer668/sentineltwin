"""API error types."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


class NotFound(ApiError):
    def __init__(self, resource: str, resource_id: str):
        super().__init__(404, "not_found", f"{resource} '{resource_id}' was not found")


class ValidationError(ApiError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(422, "validation_error", message, details)


class PayloadTooLarge(ApiError):
    def __init__(self, message: str = "Request body is too large"):
        super().__init__(413, "payload_too_large", message)


class IntegrationNotConfigured(ApiError):
    def __init__(self, integration: str, message: str | None = None):
        super().__init__(
            503,
            "integration_not_configured",
            message or f"{integration} is not configured for this deployment",
            {"integration": integration},
        )


class ServiceUnavailable(ApiError):
    def __init__(self, message: str = "The service is unavailable until persistent storage is configured"):
        super().__init__(503, "service_unavailable", message)
