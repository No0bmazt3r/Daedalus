# Project Daedalus: Finalized Architecture Overview (v2)

This document defines the finalized, production-ready architecture for Project Daedalus: A 100% Local, Multi-Device, Edge-Native Conversational Agentic AI for Industrial IoT.

## The 5 Non-Negotiable Design Rules
1. 100% Local Production: No cloud APIs in the live runtime. All inference, RAG, and orchestration happen locally on edge hardware.
2. Read-Only AI Layer: The AI cannot issue commands to reactor actuators (ABVs) or modify the SCADA system. Strict safety boundary.
3. No Numerical Hallucinations: The LLM is prohibited from guessing numbers. All sensor data is fetched deterministically via PydanticAI-enforced tools.
4. Grounded Topological Knowledge: Troubleshooting must come from Local Graph RAG, mapping physical relationships (Sensor -> Valve -> SOP).
5. Edge-Adaptive Runtime: The system must dynamically profile host hardware (RAM/VRAM) and hot-swap SLMs to guarantee <3s latency.

## The 11-Layer Architecture (Across 4 Zones)

### Zone 1 & 2: The Lab Hardware & SCADA (Pre-existing)
• Layer 1: Physical Reactor Layer — The CO₂ sorption column, sensors, and write-only Automated Ball Valves (ABVs).
• Layer 2: SCADA Layer — Existing CO2SorptionDT app polling sensors every 5s into SQLite.

### Zone 3: Read-Only AI Layer (Core Contribution)
• Layer 3: Multi-Device SQLite Data Layer — Stores time-series data. Crucially, it uses a `device_profiles` schema to support ANY IoT device, not just the CO2 reactor.
• Layer 4: Knowledge Ingestion Layer — Offline pipeline extracting entities and relationships from manuals, SOPs, and anomaly logs to build the Knowledge Graph.
• Layer 5: Local Graph RAG Layer — Uses an embedded Graph DB (KuzuDB or NetworkX) instead of Vector DBs. Maps physical topology for multi-hop reasoning (e.g., tracing a sensor fault to a downstream valve).
• Layer 6: Local Model Provider Layer — Ollama serving quantized SLMs (Qwen2.5, Llama 3.2). Includes a Hardware Profiler to recommend/swap models based on host VRAM/RAM.
• Layer 7: FastAPI Orchestration Layer — The Brain. Uses **PydanticAI** to enforce strict, typed tool-calling. Processes queries in an 11-step flow, blocking unsafe actuator commands.
• Layer 8: Dynamic Tool Layer — Instead of hardcoded tools, FastAPI dynamically generates Pydantic tools based on the specific `device_profile` being queried (e.g., if a device has a vibration sensor, the `get_vibration` tool is generated on the fly).
• Layer 10: Observability & Evaluation Layer — Local tracing (Arize Phoenix) and offline LLM-as-a-judge evaluation to score groundedness and RAG precision without cloud leakage.
• Layer 11: Admin Utility Layer — Hardware Profiler & Model Selector Console. Scans host machine, checks Ollama models, and allows one-click hot-swapping of the active SLM.

### Zone 4: Dual-Presentation Layer
• Layer 9A: Legacy PyQt5 Integration — A chat panel embedded as a tab in the existing CO2SorptionDT desktop app (using QWebEngineView or native Qt widgets).
• Layer 9B: Standalone Web Dashboard — A modern, multi-device React + Vite + TanStack Router + shadcn/ui web application. Proves the backend is fully decoupled and ready for multi-lab deployment.

## Key UI/UX Features (The "Glass-Box" Experience)
• Streaming Chat: Token-by-token streaming via FastAPI SSE.
• Tool Calling Logs: A collapsible shadcn/ui Accordion showing the agent's exact "Thought -> Action -> Observation" steps, building operator trust.
• Graph Visualizer: Mini node-graphs showing how the Graph RAG connected a sensor anomaly to a specific SOP.
• Hardware/Model Console: A dedicated settings tab showing CPU/RAM/VRAM stats and allowing the user to switch between a 7B LLM (high accuracy) and a 3B SLM (low latency).

## Multi-Device Modularity (The "Device-Agnostic" Core)
Daedalus is not hardcoded to the CO2 reactor. 
1. The React frontend uses TanStack Router for dynamic URLs (`/device/:device_id/chat`).
2. The FastAPI backend reads the `telemetry_schema` for that specific device.
3. The Graph RAG filters its traversal to only traverse nodes connected to that specific device's subgraph.