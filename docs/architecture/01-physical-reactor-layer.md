# Layer 1: Physical Reactor and Sensor Layer

> **Physical CO₂ Sorption Reactor and Sensor Layer**

* **Zone Mapping:** Zone 1
* **Purpose:** Represents the actual laboratory reactor and physical sensors producing operational data.
* **Ownership:** Existing lab infrastructure. **Not modified by this FYP.**

---

## Components

1. CO₂ sorption column/reactor
2. Temperature sensor (T-101)
3. Pressure sensor (P-101)
4. pH sensor (pH-101)
5. Level sensors (LV-101/LV-102)
6. NDIR CO₂ concentration sensor
7. Automated Ball Valves (ABVs)

---

## Data Produced

Continuous physical measurements:

| Sensor | Example Data |
|---|---|
| T-101 | Temperature in °C |
| P-101 | Pressure in barg |
| pH-101 | pH value |
| LV-101/LV-102 | Level status/value |
| NDIR CO₂ | CO₂ concentration in ppm |

---

## Safety Note

ABV valve states may be **write-only** from the SCADA perspective:
```text
SCADA can write valve state
but downstream systems may not reliably verify actual physical valve state
```
This justifies why the AI layer must not control valves.

---

## Diagram Elements

Draw these as physical icons:
```text
CO₂ Sorption Column
Temperature Sensor
Pressure Sensor
pH Sensor
Level Sensor
NDIR CO₂ Sensor
ABV Valve
```

> **Boundary Statement:** "Physical layer is existing lab equipment and is not modified by this FYP."
