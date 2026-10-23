"""Wire contracts for the cloud model-endpoint API.

The response models have **no `api_key` field**, deliberately. The store's
`public()` shape is the only thing that reaches a router, and it carries a
masked `key_hint` instead. Keeping the secret out of the schema means a future
handler cannot leak it by accident just by returning the wrong dict.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ProviderOut(BaseModel):
    """A provider offered in the UI's dropdown."""

    id: str
    label: str
    base_url: str
    docs: str


class ProviderListOut(BaseModel):
    providers: list[ProviderOut]


class EndpointCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(max_length=64, description="A provider id, or 'custom'.")
    base_url: str = Field(
        default="",
        max_length=500,
        description="Defaults to the provider's published URL when omitted.",
    )
    api_key: str = Field(default="", max_length=400)
    label: str | None = Field(default=None, max_length=120)


class EndpointUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=120)
    api_key: str | None = Field(
        default=None,
        max_length=400,
        description="An empty string clears the stored credential.",
    )
    enabled: bool | None = None


class EndpointOut(BaseModel):
    id: str
    created_at: str
    updated_at: str
    label: str
    provider: str
    base_url: str
    key_hint: str | None = None
    has_key: bool
    enabled: bool
    purpose: str
    last_tested_at: str | None = None
    last_test_ok: bool | None = None
    last_test_detail: str | None = None
    last_test_models: int | None = None


class EndpointListOut(BaseModel):
    endpoints: list[EndpointOut]


class DeleteOut(BaseModel):
    ok: bool = True
    deleted: bool
