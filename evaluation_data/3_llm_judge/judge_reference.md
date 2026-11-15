<!-- Judge context only. Copy of data/co2_sorption_reactor_reference.md (2026-11-13),
     with the lab team's names and a student ID removed: they are not needed for grading
     and this text is sent to a cloud judge. Edit the original, then re-copy. -->

# CO₂ Sorption Reactor — Consolidated Reference

Lab-scale absorption/desorption reactor, R&D Laboratory, Universiti Teknologi PETRONAS (UTP), with SCADA + 2D digital twin (CO2SorptionDT).

**Compiled from three sources.** Every fact below is tagged with its origin:

| Tag | Source | Nature |
|---|---|---|
| **[PDF]** | *Final Reactor Design, Parameters and Python Configurations for FYP and MU Students* (reviews 13/10/2023, 31/5/2024; make-good 15/5/2026; revised for 2026 FYP/MU interns 09/06/2026) | Supervisor/lab design deck: design history, parameters, SCADA software setup |
| **[SOP]** | `reactor_procedures.md` — SOP-CO2-SR-01, Rev 01 | Operating procedure for the CO2SorptionDT project |
| **[DISS]** | Lim Jia Chyuen, *Multi-Signal Change-Point Detection for Mode-Switching Decision Support in CO2 Sorption*, FYP II, Sept 2026 | Real experiment (2 Oct 2026), data-quality audit, signal analysis |

Where sources disagree, both values are given and the conflict is listed in [Section 10](#10-conflicts-gaps-and-open-questions). Statements marked *(inferred)* are my own deductions, not in the sources.

---

## 1. System at a glance

| Item | Value | Source |
|---|---|---|
| Purpose | Post-combustion-style CO₂ capture by chemical absorption, solvent regeneration by heat (desorption) | PDF, DISS |
| Location | R&D Laboratory, UTP | DISS |
| Hardware/SCADA vendor branding | Qensonic Technology (visible on the SCADA UI) | PDF, DISS |
| Control | SCADA-controlled; Python SCADA extension (PyQt5) + 2D digital twin | PDF, DISS |
| Current solvent | Potassium carbonate (K₂CO₃) | PDF, DISS |
| Original (2023) solvent | MEA (monoethanolamine), 4 M, MEA:H₂O 1:4 | PDF |
| Modes | Manual, Absorption, Desorption (radio buttons in SCADA) | PDF |
| Fabrication | Reactor fabricated by 31 May 2024 (post-fab review) | PDF |
| Sensor logging rate | 1 reading/second sent to Python | PDF |
| Recorded signals | CO₂ (NDIR), pH, temperature, pressure (+ date, time, operating mode) | DISS |
| Design pressure | Operate ~1 bar, max 5 bar ("low pressure") | PDF |

**Why K₂CO₃ instead of MEA** [DISS]: lower regeneration energy, lower degradation, less corrosive, lower toxicity and cost. Main drawback is **slow reaction kinetics** (can be improved with promoters), which is why transition/endpoint detection matters for this rig.

---

## 2. Process description and hardware

### 2.1 Process flow (from the P&ID-style schematics in [PDF])

1. **Gas supply:** premixed CO₂ + N₂ cylinder → pressure gauge/regulator → manual valve → **rotameter (gas flow)** → digital on/off valve (ABV-1) → enters the column below the packed section.
2. **Column:** vertical glass column with a **sprinkler/spray header at the top**, a **packed/multi-stage section** in the middle, and a **liquid sump with heater at the base**.
3. **Liquid loop:** sump → **pump (P-201, ON/OFF)** → **cooler/heat exchanger** → **rotameter (liquid flow)** → top-of-column valve (ABV-5) → sprinkler → down through packing → sump (counter-current gas–liquid contact).
4. **Gas outlet:** top of column → check valve → **back-pressure regulator (manual) + digital valve (ABV-4)** → **NDIR CO₂ analyser** → vented to open space.
5. **Solvent handling:** fresh-solvent bottle (feeds via ABV-3 line) and a drain valve at the base (ABV-2 region); the 2023 design also shows a waste tank.

### 2.2 Component list

| Component | Detail | Source |
|---|---|---|
| Column | Glass; 15 L volume (2023 design); sprinkler; multiple stages/trays/layers (design question marked "?" in 2023) | PDF |
| Heater | Element in the sump, driven by **TIC** (PID temperature controller); set-point and power % from SCADA | PDF, DISS |
| Cooler | Heat exchanger in liquid return loop (liquid is cooled before re-spraying) | PDF |
| Pump | Circulation pump, **ON/OFF only** (no speed control from Python) | PDF |
| Rotameters | Two: gas inlet and liquid flow. **Manual** — Python cannot read or set them | PDF |
| Back-pressure regulator | **Manual**; set max pressure at start-up | PDF |
| Digital pressure-swap valve | Used to move pressure low→high (absorption) and high→low (desorption) | PDF |
| NDIR sensor | CO₂ concentration at gas outlet; digital read; separate serial connection | PDF, DISS |
| Level sensors | LV-101, LV-102; **binary** (high/low) | PDF, SOP |
| pH sensor | pH-101, digital read; used to judge solvent efficiency and desorption completeness | PDF |
| Pressure sensors | P-101 in SCADA (PDF schematic shows several "P" points) | PDF |
| Temperature sensor | T-101 (column/bed), feeds TIC | PDF |
| Gas | Premix CO₂+N₂ cylinder (smallest 10 L) at 50 bar, up to 100 bar; the gas tank and piping from the gas storeroom were **not covered in the vendor quotation** | PDF |
| Safety hardware | Emergency-stop button, interlocks, level-sensor pump trip, PCV-104 | SOP |
| Physical cabinet | Control cabinet with red E-stop and yellow switches; the 2 Oct 2026 run used a CO₂ cylinder connected by tubing | DISS (Appendix 7 photo) |

### 2.3 Control vs manual (colour legend used on the SCADA/design slides) [PDF]

| Colour/symbol | Meaning |
|---|---|
| Blue | Manual (by hand) |
| Green | Open (digital valve) |
| Red | Closed (digital valve) |
| Orange | Readable by Python |
| Valve with actuator symbol | Digital on/off from Python, **but its state is not readable by Python** |
| Plain valve symbol | Manual valve by hand |

**Digital controls:** heater (settable temperature), pump (on/off), valves (open/close).
**Digital reads:** NDIR, level (binary), temperature (°C), pressure, pH.
**Manual only:** rotameters (and the back-pressure regulator).

> Consequence: the digital twin shows *commanded* valve state, not confirmed physical state (valve state is not readable). *(inferred)*

---

## 3. SCADA tag and valve map

Tags as seen on the SCADA screen [DISS/PDF] and in the SOP:

| Tag | Description | Type |
|---|---|---|
| P-101 | Column pressure (barg) | Sensor |
| T-101 | Column/bed temperature (°C) | Sensor |
| pH-101 | Solution pH | Sensor |
| LV-101, LV-102 | Level indicators (binary); SOP: zero reading = column empty, high-level interlock stops pump | Sensor |
| NDIR | Outlet CO₂ (ppm) | Sensor |
| PCV-104 | Pressure control valve on gas inlet; drops gas input if upstream pressure surges | Valve |
| BV-101 (SCADA) / BV-1 (SOP) | Ball valve, main gas inlet | Valve |
| ABV-1 | Gas-inlet automatic valve (SOP: "main liquid feed loop line") | Valve |
| ABV-2 | Base drain/transfer valve | Valve |
| ABV-3 | Fresh-solvent / reservoir line | Valve |
| ABV-4 | Gas outlet/vent line (used for depressurising) | Valve |
| ABV-5 | Top spray header | Valve |
| P-201 | Circulation pump (SOP calls it "Motor") | Actuator |
| TIC + H | Heater and its temperature controller | Actuator |
| PRV-1 / PRV-2 | Pressure regulating valves (SOP only) | Valve |
| R1 / R2 | Rotameters (SOP uses "R2" for liquid flow) | Manual |

> Functions of ABV-1…5 differ between SOP text and the SCADA/PDF schematics; see conflict C6.

---

## 4. Operating conditions

### 4.1 Evolution of parameters

| Parameter | 2023 design (MEA) [PDF] | K₂CO₃ sheet [PDF] | SOP [SOP] | 2 Oct 2026 experiment [DISS] |
|---|---|---|---|---|
| Solvent | MEA 4 M, 1:4 MEA:H₂O | K₂CO₃, **50 % w.t.** | "Catalyst/solvent solution" | **600 g/L** K₂CO₃ |
| Inlet gas CO₂ | 15 % | 15 % premixed with N₂ (also a note says "Input 20 % CO₂") | — | **Pure CO₂** |
| Gas flow | 2–8 L/min | **≤ 100 mL/min** (slower is better) | — | not stated |
| Solvent flow | 1 L/min | **> 50 mL/min** (faster is better, recyclable) | set by R2 | not stated |
| Gas inlet temp | 30 °C (pre-heated) | 100 °C (as laid out on slide; see C9) | — | — |
| Column temp | 35 °C | **60 °C absorb / 120 °C desorb** | 25–110 °C safe; heater set **110 °C** for desorption | **50 °C** controlled |
| Column pressure | "?" | 1 bar operating, max 5 bar | 1.0–3.5 barg safe; trip > 5.0 | **1 barg** controlled |
| pH | 9–11 | 9–11 (higher better); ideal 11–12; < 8 = not efficient | 8.5–11.0 safe; < 7.0 = deactivation | started **11.29** |
| Cylinder | — | 50 bar standard, up to 100 bar | PRV-1 = 3 bar, PRV-2 = 1 bar | CO₂ cylinder |

### 4.2 Design rules (2023) [PDF]
- Input gas pressure > column pressure.
- MEA flow rate > input gas flow rate.
- (Rule numbering is swapped between the "parameters" and "rules" lists in the original slide.)

### 4.3 K₂CO₃-specific notes [PDF]
- Heating increases concentration. **Particles may form on the wall at ~60 °C during absorption**; the higher desorption temperature (120 °C) is used to dissolve them.
- Higher pressure favours absorption. Use premix gas.
- NDIR acceptance: inlet 20 % CO₂, outlet **8 % → 5 % is acceptable in industry**; outlet must go to open space; raise pressure to improve capture.

### 4.4 pH as the solvent-state indicator [PDF]
- Ideal pH 11–12. **pH < 8 → solvent not efficient → go to desorption.**
- Desorption releases CO₂ (acidic), so solvent pH **rises** when well regenerated.
- Absorption: if the pH meter reads very acidic, stop absorption and switch to desorption.

---

## 5. Operating modes

### 5.1 Absorption [PDF]
Open valves, **heater off**, **increase pressure**. Pump on, liquid sprayed from top, gas fed from bottom. Monitor pH and NDIR; stop and desorb when pH drops too far.

### 5.2 Desorption [PDF]
Close most valves, **pump off**, **lower pressure**. Heat the sump solvent to release CO₂.
1. Heat for **5 hours**.
2. Cool down for **1 hour**.
3. Open valves in absorption configuration, run pump, read pH.
4. **Low pH (acidic) → insufficient desorption → revert.** **High pH → sufficient → proceed with absorption.**
(pH meter use for this check is marked "to be confirmed" in the deck.)

### 5.3 SCADA behaviour
Mode radio buttons: Manual / Absorption / Desorption. Version 2 of the software adds logistic-regression-based alarm/threshold logic (see Section 7).

---

## 6. Standard Operating Procedure summary [SOP]

*SOP-CO2-SR-01 Rev 01. Provenance: appears project-written; several details are not in the supervisor's deck (see Section 10).*

### 6.1 Initial start-up (load solvent: reservoir → column)
Pre-checks: stable power, `MainUI_v3.py` live, interlocks responsive, no trip codes. Then in order:
1. PRV-1 = 3 bar
2. PRV-2 = 1 bar
3. Open BV-1
4. Open ABV-3
5. Open ABV-5
6. Open ABV-1
7. Open ABV-4
8. Pump motor ON

### 6.2 Normal operation
| Mode | Steps |
|---|---|
| **Absorption** | PRV-1 3 bar, PRV-2 1 bar; open BV-1; ABV-1, ABV-2, ABV-5 open; motor ON; adjust R2 for liquid flow; watch NDIR outlet drop |
| **Desorption** | PRV-1 3 bar, PRV-2 1 bar; open BV-1; **TIC heater = 110 °C**; ABV-1 and ABV-4 open to send CO₂ out |

### 6.3 Temporary operation
- **Manual overrides** if automation hangs: toggle ABV-1…5 from the dashboard.
- **Low-flow recirculation** during short breaks: close BV-1, keep liquid loop at minimum flow via R2 to prevent catalyst dry-out.

### 6.4 Emergency shutdown (ESD)
**Triggers:** P-101 > 5.0 bar; T-101 > 120 °C; E-stop pressed.
**Sequence:** (1) trip power to pump motor and TIC heater; (2) close BV-1; (3) force open ABV-4 to vent to scrubbers.

### 6.5 Emergency operation
Keep SCADA open to read flags (`SENSOR FAULT`, `HIGH PRESSURE`); if automatic valves fail, use manual backup handwheels; **evacuate** if toxic gas leaks beyond containment.

### 6.6 Normal shutdown (column → reservoir)
PRV-1 3 bar / PRV-2 1 bar; open BV-1; ABV-2, ABV-3, ABV-5 open; wait for LV-101/LV-102 to read zero; turn off all utilities and close all process valves.

### 6.7 Restart after trip
Root-cause and clear the error flag (`IoT CONNECTION ERROR`, `SEQUENCE ERROR`) → **N₂ purge** of lines → full cold start per 6.1.

### 6.8 Operating limits

| Parameter | Tag | Safe range | Critical trip |
|---|---|---|---|
| Column pressure | P-101 | 1.0–3.5 barg | > 5.0 barg |
| Bed temperature | T-101 | 25–110 °C | > 120 °C |
| Solution pH | pH-101 | 8.5–11.0 | < 7.0 |

### 6.9 Corrective action
- P-101 > 3.5 barg → software throttles PCV-104 back or alerts to open ABV-4.
- T-101 beyond 110 °C during desorption → TIC cuts heater power.

### 6.10 Safety and health
- CO₂: asphyxiation hazard in confined spaces. Solvent: corrosive; avoid inhalation/ingestion.
- PPE: chemical splash goggles, face shield, neoprene gloves, anti-static lab coat during maintenance.
- Safety systems: PCV-104, level-sensor pump interlock (flooding), NDIR leak/purity logging.

---

## 7. Software, data acquisition and architecture

### 7.1 Software stack [PDF]
- **Program:** `miniAbsorp2.py` (version 2, with logistic regression). `miniAbsorp.py` is the raw manufacturer code. A later working copy `miniAbsorp2_2` and `MainUI_v3.py` (SOP) also exist. Project folder reference: "mini adsorption rig alarm – newest20250717".
- **Supporting files seen:** `SorptionMode` (AbsorptionMode, DesorptionMode classes), `ThresholdAD` class (anomaly detection with `sklearn LogisticRegression`), `desorption_threshold` and `anomaly_details` spreadsheets, `ui_V1_alarm.ui` (Qt Designer layout), `mplwidget`, camera helper modules (`CameraParams_*`, `CamOperation_class`, `MvCameraControl_class`).
- **GUI:** PyQt5; layout in Qt Designer; loaded with `loadUi("ui_V1_alarm.ui", self)`; buttons wired with `.clicked.connect(...)`. Plots via matplotlib / `pyqtgraph`.
- **UI tabs:** Main, Setting, Data, Visualization, PSI. Heater panel: *Set T-101 (°C)*, *Power %*, Start/Stop. Pump P-201 ON/OFF. Alarm indicator. Live charts: CO₂ ppm, pressure barg, temperature °C, pH (rolling ~100 s window).

### 7.2 Environment setup [PDF]
1. **Uninstall Anaconda completely** (it shadows PySerial with its own `serial` module → hanging).
2. Install **standalone Spyder** (6.0.7, 64-bit) with its own Python (3.11 seen).
3. Verify: `import sys; print(sys.executable)` → must point to Spyder's Python.
4. `subprocess.check_call([sys.executable, "-m", "pip", "install", "pyserial"])` (pyserial 3.5 seen); confirm `hasattr(serial, 'Serial')` → `True`.
5. Install on demand: `pyqtgraph` (0.13.7), `scikit-learn` (1.7.0), `pyqt5`.
6. Spyder run configuration: tick **"Run in console's namespace instead of an empty one"** (fixes "global statement in empty namespace" warning). Best practice: avoid `global`; use functions/modules.
7. If Anaconda is reinstalled later, use a conda virtual environment (`conda create -n my_env python=3.9`, then `pip install pyserial`).

### 7.3 Serial communication [PDF, DISS]
- Two serial links: **sensors/controller** and **NDIR** (e.g. COM4 and COM6 in the 2026 deck; COM2 in the May 2024 meeting).
- Temperature, pressure and pH share **one** serial connection; CO₂ uses a **different** one [DISS].
- FTDI chipset devices (FT232R USB UART) need the **FTDI CDM driver** (v2.12.36.4); fix a yellow-warning COM port via Device Manager → Update driver → browse to downloaded driver. Prolific/CH340 devices need their own drivers.
- Command example (pump OFF) sent over serial: `"113;1;0;0;e"` built from fields separated by `;`, terminated with `e`, followed by a 0.1 s delay.
- Threading (2024 prototype): main thread reads all sensors and writes valves/pump; second thread is read-only NDIR.

### 7.4 Planned connectivity architecture [PDF]
`Reactor → Basic SCADA → Laptop running Python SCADA extension + AI models → MySQL DB (read tables / write tables) → Web dashboard (e.g. Supabase)`
- Website: pages introducing team and research; dashboard with **private login by UTP admin**, gauges and trend charts.
- Dashboard **reads** displayable data and **writes** control + parameter changes via the DB; hosting must run for extended periods.

### 7.5 Original 2024 next steps [PDF]
1 absorber parameters/configs; 2 desorber parameters/configs; 3 obtain K₂CO₃ and MEA and determine optimal threshold values; 4 Python control code to switch to absorber; 5 Python control code to switch to desorber.

---

## 8. Experimental data (2 Oct 2026) [DISS]

### 8.1 Run configuration
| Item | Value |
|---|---|
| Date / time | 2 Oct 2026, 11:46:46–14:37:22 |
| Gas inlet | Pure CO₂ |
| Solvent | 600 g/L K₂CO₃ |
| Controlled temperature | 50 °C |
| Controlled pressure | 1 barg |
| Rows | 10,226 (≈1 Hz) |
| Outcome | **Run ended early: potassium bicarbonate crystallised and clogged the reactor tubes** |

### 8.2 Data-quality audit
| Indicator | Rows | % of recording |
|---|---|---|
| CO₂ at the 2001 ppm sensor ceiling | 6,521 | 63.77 |
| Suspected shared signal freeze (temp, pressure, pH unchanged ≥ 60 s) | 1,558 | 15.24 |
| Duplicate timestamps | 602 | 5.89 |
| Invalid temperature | 721 | 7.05 |
| Invalid pressure | 723 | 7.07 |
| Invalid pH | 734 | 7.18 |
| All four channels zero | 7 | 0.07 |
| Unparseable timestamps / time reversals / gaps | 0 | 0 |

Flags overlap. Retained after screening: **6,142 rows in 9 segments** (pH+T+P, 60.06 %) and **2,835 rows in 3 segments** (CO₂ only, 27.72 %).

Screening ranges (analysis settings, not operating limits): T 0–100 °C; P −0.2 to 6 barg; pH 0–14; CO₂ 0–2001 ppm. A segment needs ≥ 30 observations and ≥ 120 s; a new segment starts after an excluded row, non-increasing timestamp, gap > 3 s or mode change.

**Freeze cause:** loss of serial connection between SCADA and the digital twin (T/P/pH share a link; CO₂ does not).

### 8.3 Best usable interval: segment S005
- 13:17:06–13:27:49 (644 rows), logged during absorption with pure CO₂ before clogging.

| Quantity | pH | Temperature | Pressure |
|---|---|---|---|
| First value | 11.29 | 48.91 °C | 1.05 barg |
| Observed span | 0.22 (→ ≈ 11.07) | 9.95 °C | 0.40 barg |
| Median slope | −0.0236 pH/min | +0.760 °C/min | +0.047 barg/min |
| Median residual SD | 0.0029 | 0.291 °C | 0.047 barg |
| Lag-1 residual correlation | 0.50 | 0.94 | 0.85 |
| Unchanged consecutive readings | 94.9 % | 5.1 % | 32.2 % |

Calibrated decline rate δ = **0.0252 pH/min** (median of declining windows). Pressure background median 1.09 barg. Other segments: S004 median slope −0.021 pH/min (also contained rising windows); S008 slightly positive. pH trend does not always follow the logged "absorption" label.

---

## 9. Analytical work done on this data [DISS]

**Goal:** decision support for *when to switch mode* from absorption, using pH, temperature and pressure (CO₂ excluded as unreliable). Not autonomous control; desorption out of scope.

**Pipeline**
1. Causal 31-sample weighted Savitzky–Golay smoothing (weights 0.2 → 1).
2. 30 s non-overlapping block slopes per channel (feature every 30 s), standardised with development-fitted centre/scale (pH slope: −0.02553 ± 0.01155; T: 0.691 ± 1.930; P: 0.0018 ± 0.290).
3. Detectors: pH slope-change baseline (threshold 1.5), pH-only BOCPD and three-channel BOCPD (threshold 0.2, hazard 0.05).
4. 180 s warm-up, 120 s refractory period; confirmation by K2 / K4 consecutive near-flat pH blocks (|slope| ≤ 0.30 δ ≈ 0.0076 pH/min).

**Evaluation:** 2,000 synthetic traces (720 s at 1 Hz; 5 scenarios × 2 fluctuation levels × 200 seeds) calibrated on S005, plus descriptive replay on S005.

**Key results**

| Finding | Number |
|---|---|
| Nominal abrupt-flattening recall (baseline / pH-only / 3-ch BOCPD) | 90.0 % / 63.0 % / 51.5 % |
| Nominal gradual-flattening recall | 77.0 % / 35.0 % / 26.5 % |
| False alarms on continued decline (nominal) | 16.5 % / 0.5 % / 0.5 % |
| False alarms when fluctuation doubled | 80.0 % / 62.0 % / 90.0 % |
| 3-ch BOCPD K2 → K4 abrupt recommendation recall | 42.0 % → 18.0 % |
| 3-ch BOCPD K2 → K4 false recommendation on temporary pause | 43.5 % → 19.5 % |
| Pressure pulse (0.20 bar, 90 s) alarm increase, 3-ch nominal | +10.0 pp (onset), +13.5 pp (recovery) |
| Processing cost | 15.88 ms per 720 s trace (0.66 ms/block) |
| S005 replay | Baseline and pH-only: K2 candidate at **13:26:35**; 3-ch: no alarm; no K4 candidate |

**Take-aways for the reactor:** extra channels did not help detect a pH plateau but did detect pressure disturbances; confirmation by persistence cannot distinguish a temporary pause from a true plateau; no result is validated against an independent saturation measurement. Recommendations should be shown to operators with signal history, not used to switch the reactor automatically.

**Literature context** [DISS]: a 25 % K₂CO₃ solution (loading ≈ 0.3) had not reached equilibrium after 90 min at ≈ 50 °C but did after ≈ 50 min at 75 °C (Walthert) — equilibrium time depends on conditions; no fixed pH or duration marks saturation.

---

## 10. Conflicts, gaps and open questions

| # | Issue | Detail | Why it matters |
|---|---|---|---|
| C1 | **Desorption temperature** | PDF: 120 °C (desorb). SOP: heater set 110 °C; T-101 safe range ≤ 110 °C; **ESD trips at > 120 °C**; corrective action cuts heater past 110 °C | Deck's own regeneration target sits at the SOP's ESD trip |
| C2 | **pH window** | PDF: ideal 11–12, < 8 inefficient, 9–11 operating. SOP: safe 8.5–11.0, < 7.0 "deactivation". DISS run started at **11.29** (above SOP safe max) | SOP limits would flag a healthy fresh solvent |
| C3 | **Pressure** | PDF: 1 bar operating, 5 bar max. SOP: 1.0–3.5 barg safe, trip > 5.0, regulators PRV-1 3 bar / PRV-2 1 bar. DISS run at 1 barg | Operating vs regulator set-points need reconciling |
| C4 | **Solvent terminology and chemistry** | SOP calls the liquid "catalyst solution"/"catalyst deactivation"; sources describe a K₂CO₃ solvent (MEA in 2023) | SOP wording appears generic |
| C5 | **Desorption procedure** | PDF: pump off, most valves closed, lower pressure, heat 5 h, cool 1 h, pH verify. SOP: ABV-1 + ABV-4 open, heater 110 °C; no pump-off, duration or pH check | SOP omits key deck steps |
| C6 | **Valve naming/function** | SOP BV-1 vs SCADA BV-101; SOP describes ABV-1 as liquid feed, ABV-3 as reservoir return, while the deck shows ABV-1 on the gas inlet, ABV-5 as spray header, ABV-3 on fresh-solvent line | Verify against physical rig/P&ID before any sequence is automated |
| C7 | **Gas concentration** | PDF: 15 % premix (and "input 20 %" note); DISS run used pure CO₂ | Different basis for capture-efficiency targets |
| C8 | **Solvent concentration units** | PDF "50 % w.t." vs DISS "600 g/L" | Not directly comparable without solution density |
| C9 | **Inlet gas temperature** | MEA design 30 °C pre-heated; K₂CO₃ slide layout reads 100 °C | Confirm against original slide |
| C10 | **NDIR range** | DISS: sensor ceiling 2001 ppm (≈ 0.2 %), saturated in 63.8 % of rows; deck expects 20 % → 5–8 % outlet (≈ 50,000–200,000 ppm) | *(inferred)* the installed sensor range cannot resolve percent-level outlet CO₂; confirm range/model and calibration |
| C11 | **Rule numbering (2023)** | Rule 1/Rule 2 swapped between slide lists | Minor |
| C12 | **Liquid vs gas flow rule** | 2023 rule: liquid flow > gas flow. K₂CO₃ figures: gas ≤ 100 mL/min, liquid > 50 mL/min | Unclear whether the rule still applies |
| C13 | **SOP provenance** | Not in supervisor's deck; includes PRV settings, N₂ purge, `MainUI_v3.py`, ESD thresholds | Treat as draft until approved |
| C14 | **Crystallisation** | Deck: wall particles at ~60 °C; DISS: KHCO₃ clog at 50 °C, 600 g/L, pure CO₂ | No procedure covers clog prevention or clearing |
| C15 | **Serial ports** | COM2 (2024), COM4/COM6 (2026) | Port numbers are machine-specific |

**Information missing from all sources:** column packing type and dimensions (beyond 15 L), pump model/flow capability, heater power, sensor ranges/accuracy (pH, T, P), sampling-port usage, actual flow rates in the 2 Oct run, full pre/post-run solvent loading, desorption run data, and any independent CO₂ uptake measurement.

---

## 11. Practical lessons evident in the data

1. **Crystallisation risk** with concentrated K₂CO₃ + pure CO₂ ended the only long run; solid KHCO₃ clogged tubing.
2. **Serial freezes** (≈ 15 % of rows) are a communication problem, not process behaviour; check for COM-port conflicts and Anaconda shadowing first.
3. **pH is coarse for slow trends:** 95 % of consecutive pH readings were unchanged (resolution ≈ 0.01), so a flat stretch is not necessarily a plateau.
4. **NDIR saturation** removes the only direct performance signal; without a calibrated outlet measurement, endpoint decisions rest on pH only.
5. **Temperature rose ~10 °C** during S005 despite a 50 °C set-point (heater control, process heat or other effects; cause not established).
6. **Valve state is not readable** — treat digital twin valve colours as commands.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| ABV / BV | Automatic (digital) ball valve / manual ball valve |
| BOCPD | Bayesian Online Change-Point Detection |
| barg | Gauge pressure in bar |
| NDIR | Non-dispersive infrared CO₂ sensor |
| PCV / PRV | Pressure control / regulating valve |
| SCADA | Supervisory Control and Data Acquisition |
| TIC | Temperature indicator controller (PID) for the heater |
| K2 / K4 | Confirm a candidate after 2 / 4 consecutive near-flat pH blocks |
| S005 | Selected 644-row segment of the 2 Oct 2026 run |
| Absorption / Desorption | CO₂ capture into solvent / heat-driven solvent regeneration |

*Not inspected:* Gantt charts and lab-session photos in the dissertation appendices (only the SCADA screenshots and cylinder photo were viewed).
