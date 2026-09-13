# Layer 9: PyQt5 Presentation Layer

> **PyQt5 Conversational Submodule**

* **Zone Mapping:** Zone 4
* **Purpose:** User-facing chat panel embedded inside CO2SorptionDT. Allows users to ask questions and view grounded answers.
* **Technology:** **PyQt5**
* **Integration Method:** Embedded as a tab or dockable panel inside the existing CO2SorptionDT application. **Not a separate standalone app.**

---

## UI Components

1. Chat history area
2. User input box
3. Send button
4. Loading indicator
5. Citation/source panel
6. Error message area
7. Optional source badges
8. Optional query suggestions

---

## Source Badges

Show where the answer came from:
```text
[Live DB]
[Trend Query]
[SOP]
[Manual]
[Anomaly Record]
```

---

## Example UI Layout

```text
--------------------------------------------------
CO2SorptionDT Dashboard

Tab: Reactor View | Trends | AI Assistant

--------------------------------------------------
AI Assistant

Chat History:
User: Is the reactor running fine?
Assistant: The reactor appears stable. Current temperature is 28.0°C,
pressure is 1.50 barg, pH is 7.00, and CO₂ is 400.0 ppm.
No anomaly flag is present in the latest reading.
[Source: SQLite 10:00:05]

User: What should I do if CO₂ rises sharply?
Assistant: According to the SOP, check NDIR calibration and gas flow...
[Source: SOP_Pressure.pdf, Page 6]

--------------------------------------------------
[ Type your question here ] [Send]
--------------------------------------------------
```

---

## UI Responsibilities

The UI **should:**
1. Send user query to FastAPI
2. Show loading state
3. Display response
4. Display citations
5. Display errors clearly
6. Prevent multiple duplicate submissions
7. Allow scrolling through history
8. Show if response is grounded or uncertain

---

## UI Must NOT

1. Generate answers itself
2. Query SQLite directly
3. Query vector DB directly
4. Call Ollama directly
5. Send control commands
6. Store sensitive logs in plain text without care

> **Constraint:** The UI purely acts as a client to the FastAPI `/api/chat` endpoint.

---

## Diagram Elements

Desktop window:
```text
CO2SorptionDT
  - Existing SCADA Dashboard
  + AI Chat Tab
```

Arrow:
```text
PyQt Chat Panel → FastAPI /api/chat
```
