"""Pydantic request/response schemas.

Kept apart from the stores so the wire contract can change without touching
persistence, and from the services so neither layer has to import FastAPI.
"""
