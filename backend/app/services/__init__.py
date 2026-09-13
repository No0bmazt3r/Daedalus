"""Application services — the layer between HTTP and the stores.

Routers translate HTTP; stores translate SQL. Anything that is a *decision*
lives here, so the orchestrator (Layer 7) can make the same decisions without
going through HTTP.
"""
