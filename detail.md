# MainUI_v3.py — Full Technical Breakdown

`MainUI_v3.py` is the PyQt5 control screen for the CO₂ absorption/desorption rig. It:

- loads the layout from `ui_MainUI_v3.ui`
- talks to **two microcontrollers over serial**: the primary process controller and the NDIR CO₂ sensor
- plots live sensor data and logs it to a table
- switches valve patterns for Absorption and Desorption modes
- sends Telegram alerts and plays a sound when an alarm fires

Window title at runtime: `"D2O batch SCADA system"`. This is left over from an older project.

---

## Table of Contents

1. [Files and Dependencies](#1-files-and-dependencies)
2. [Architecture Overview](#2-architecture-overview)
3. [Startup Sequence](#3-startup-sequence)
4. [UI Widget → Code Mapping](#4-ui-widget--code-mapping)
5. [Serial Communication](#5-serial-communication)
6. [Serial Protocol Reference](#6-serial-protocol-reference)
7. [Sensor Scaling (Calibration)](#7-sensor-scaling-calibration)
8. [Data Flow and Buffers](#8-data-flow-and-buffers)
9. [Timers and Periodic Work](#9-timers-and-periodic-work)
10. [Operating Modes](#10-operating-modes)
11. [Alarm and Anomaly System](#11-alarm-and-anomaly-system)
12. [CO₂ Analysis Plots (Absorption / Desorption tabs)](#12-co₂-analysis-plots-absorption--desorption-tabs)
13. [Table Logging and CSV Export](#13-table-logging-and-csv-export)
14. [Method Reference](#14-method-reference)
15. [Instance State Reference](#15-instance-state-reference)
16. [Threading Model](#16-threading-model)
17. [Known Bugs and Risks](#17-known-bugs-and-risks)
18. [Dead / Unused Code](#18-dead--unused-code)
19. [Relationship to Other Files in the Repo](#19-relationship-to-other-files-in-the-repo)
20. [Suggested Fix Priority](#20-suggested-fix-priority)

---

## 1. Files and Dependencies

### Files MainUI_v3.py uses at runtime

| File | Used for | Where |
|---|---|---|
| `ui_MainUI_v3.ui` | The whole window layout, loaded with `loadUi` | `__init__` (line 67) |
| `mplwidget.py` | `MplWidget` custom widget (a Matplotlib canvas inside a QWidget). The `.ui` declares header `mplwidget.h`; `uic` converts that to `import mplwidget` | Through the `.ui` file |
| `SorptionMode.py` | `AbsorptionMode(interface)` and `DesorptionMode(interface)`, which set the valve patterns | Line 44, used in `absorption_mode()` / `desorption_mode()` |
| `absorption_threshold.csv` | Temperature/pressure limits for Absorption | `initialize_thresholds()` |
| `desorption_threshold.csv` | Temperature/pressure limits for Desorption | `initialize_thresholds()` |
| `ValveOpen.jpg`, `ValveClosed.jpg` | Icons for vertical valves (ABV-101, 103, 104, 105) | `ABV_10x_function` |
| `ValveOpen90.jpg`, `ValveClosed90.jpg` | Icons for the horizontal valve (ABV-102) | `ABV_102_function` |
| `L_GREEN.jpg`, `L_RED.jpg` | Level-switch indicator images. **On disk they are named `L_GREEN.JPG` / `L_RED.JPG`** (see bug #9) | `__init__`, `backgroundThread` |
| `anomaly_details.csv` | Anomaly log (appended to) | `save_anomaly_details()` |
| `C:/mini adsorption rig alarm/mini adsorption rig alarm/alarm_beep.wav` | Alarm sound, hardcoded Windows path | `triggerAnomalyAlert`, `send_telegram_message` |

### Threshold CSV contents

`absorption_threshold.csv`

| parameter | min_threshold | max_threshold |
|---|---|---|
| temperature | 30 | 90 |
| pressure | 1 | 5 |

`desorption_threshold.csv`

| parameter | min_threshold | max_threshold |
|---|---|---|
| temperature | 20 | 120 |
| pressure | 1 | 5 |

Both files start with a UTF-8 BOM (an invisible `\ufeff` marker at the start of the file). pandas removes it when reading, so the `parameter` column lookup works. If you ever read these files with the plain `csv` module instead, open them with `encoding="utf-8-sig"`, or the first header becomes `"\ufeffparameter"`.

### Python libraries

| Library | Used? | For |
|---|---|---|
| `PyQt5` (QtWidgets, QtCore, QtGui, uic, QtMultimedia) | Yes | UI, timers, icons, `QSound` |
| `matplotlib` (`Figure`, `FigureCanvasQTAgg`) | Yes | All charts |
| `numpy` | Yes | Rolling buffers, regression input |
| `pandas` | Yes | Reading threshold CSVs, EMA smoothing |
| `pyserial` (`serial`) | Yes | Both serial links |
| `requests` | Yes | Telegram Bot API |
| `scikit-learn` (`LogisticRegression`) | Yes | Analysis plots |
| `threading.Thread` | Yes | Serial reader threads |
| `csv`, `time`, `sys` | Yes | Logging, delays, entry point |
| `random`, `matplotlib.pyplot`, `NavigationToolbar`, `pyqtgraph`, `PlotWidget`, `math`, `datetime`, `os`, `os.path`, `QImage`, `QColor`, `QTime`, `time.sleep` (separate import) | **No** | Unused imports |

`sys.path.append("..")` at line 54 is also unnecessary.

---

## 2. Architecture Overview

```
┌──────────────────────────────── CUASinterface (QMainWindow) ────────────────────────────────┐
│                                                                                              │
│  loadUi("ui_MainUI_v3.ui")                                                                   │
│                                                                                              │
│  ┌── GUI thread ──────────────────────────────────────────────────────────────────────────┐  │
│  │  Button clicks ─► valve / pump / heater / PID / calibration commands ─► serial write   │  │
│  │  timerplot (1 s) ─► update_graph() ─► 4 MplWidgets + check_anomaly() + update_table()  │  │
│  │  co2_timer (1 s, after first mode select) ─► visualizationAB_graph / DE_graph          │  │
│  └────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌── Thread 1: backgroundThread ──┐          ┌── Thread 2: backgroundThread_2 ──┐            │
│  │ reads COM4 (primary)           │          │ reads COM6 (NDIR CO₂)            │            │
│  │ "203;…" → P, T, pH buffers     │          │ "…,…,…,CO2,…" → CO₂ buffer       │            │
│  │ "204;…" → level switches, power│          │                                  │            │
│  │ calls check_anomaly()          │          │                                  │            │
│  └───────────────┬────────────────┘          └───────────────┬──────────────────┘            │
│                  │ y_var2 / y_var3 / y_var4                  │ y_var5                        │
│                  └──────────────────► shared numpy buffers ◄─┘                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
          │ serial                                         │ serial
          ▼                                                ▼
 Primary controller (COM4, 115200)                NDIR CO₂ sensor (COM6, 115200)
 pump, 5 valves, heater, PID,                     CO₂ ppm, calibration
 P-101, T-101, pH, LS-101, LS-102
```

---

## 3. Startup Sequence

When you run `python MainUI_v3.py`:

1. `QApplication(sys.argv)` is created.
2. `CUASinterface()` is built. In `__init__`:
   1. `loadUi("ui_MainUI_v3.ui", self)` adds every widget in the `.ui` file as an attribute (`self.ABV_101`, `self.tableWidget`, and so on). **The path is relative, so you must run the script from the repo folder.**
   2. Loads the level-switch pixmaps `sensorL` (green) and `sensorH` (red).
   3. Connects buttons to their handlers (pump, heater, PID, ABV-101..105, Connect, Connect_2, Save, Clear, the 3 mode radio buttons, Alarm, and the 3 NDIR calibration buttons).
   4. Creates the rolling buffers `y_var2..y_var5`: 200 zeros each (`plot_window = 200`).
   5. Fills in default COM ports: `textEdit1 = "com4"`, `textEdit1_2 = "com6"`.
   6. Sets up connection state for both serial links (status, thread, run flags).
   7. Starts `timerplot`, a 1000 ms QTimer that calls `update_graph`.
   8. Sets up `tableWidget` with 7 columns: `Date, Time, T-101[C], P-101[barg], pH-101[-], CO2[ppm], Mode`.
   9. Sets the mode flags to `False` and `alarm_enabled` to `False`.
   10. `initialize_thresholds()` reads both threshold CSVs.
   11. Stores the Telegram bot tokens and chat IDs.
3. `window.setWindowTitle("D2O batch SCADA system")`, `window.show()`.
4. `app.exec_()` starts the event loop.

**Nothing is connected at startup.** The timer runs anyway, so the charts show 200 zeros and the table gets a row of `0.00` values every second until you connect.

---

## 4. UI Widget → Code Mapping

Every widget the code refers to by name. All of them exist in `ui_MainUI_v3.ui` except `pushButton_Heater_Set`. The code calls `pushButton_Heater_Set_function`, which doesn't exist anywhere.

### Connection

| Widget | Type | Code |
|---|---|---|
| `Connect` | QPushButton | `Connection()`: connect/disconnect the primary link |
| `Connect_2` | QPushButton | `Connection_2()`: connect/disconnect the NDIR link |
| `textEdit1` | QTextEdit | Primary COM port (default `com4`) |
| `textEdit1_2` | QTextEdit | NDIR COM port (default `com6`) |
| `label3` | QLabel | Primary status text (Connecting / Connected / Disconnected / Failed) |
| `label3_2` | QLabel | NDIR status text |

### Actuators

| Widget | Type | Handler | Command sent |
|---|---|---|---|
| `pushButton_PumpON` | QPushButton | `pushButton_PumpON_function` | `113;1;1;1;e` |
| `pushButton_PumpOFF` | QPushButton | `pushButton_PumpOFF_function` | `113;1;1;0;e` |
| `pushButton_Heater_ON` | QPushButton | `pushButton_Heater_ON_function` | `226;1;{raw};0;e` then `113;1;7;1;e` |
| `pushButton_Heater_OFF` | QPushButton | `pushButton_Heater_OFF_function` | `226;1;0;0;e` then `113;1;7;0;e` |
| `pushButton_Heater_PID` | QPushButton | `pushButton_Heater_PID_function` | `227;1;M;P;I;D;e` |
| `ABV_101` | QPushButton (checkable) | `ABV_101_function` | `113;1;2;{0/1};e` |
| `ABV_102` | QPushButton (checkable) | `ABV_102_function` | `113;1;3;{0/1};e` |
| `ABV_103` | QPushButton (checkable) | `ABV_103_function` | `113;1;4;{0/1};e` |
| `ABV_104` | QPushButton (checkable) | `ABV_104_function` | `113;1;5;{0/1};e` |
| `ABV_105` | QPushButton (checkable) | `ABV_105_function` | `113;1;6;{0/1};e` |

The pump's on/off state is not stored in a variable. It is stored in **which button is enabled**:

- Pump ON → `PumpON` disabled, `PumpOFF` enabled
- Pump OFF → `PumpON` enabled, `PumpOFF` disabled

`check_safety_conditions` relies on this.

### Heater inputs

| Widget | Meaning |
|---|---|
| `lineEdit_Tem_SV` | Heater temperature setpoint [°C] |
| `lineEdit_PID_P`, `_I`, `_D`, `_M` | PID gains and M (mode/max; sent as the first value) |
| `lineEdit_Power` | Shows heater output power received from the controller (`204` message) |

### Calibration inputs (raw value ↔ physical value)

| Sensor | Raw low / high | Physical low / high |
|---|---|---|
| Pressure P-101 | `lineEdit_P101_L_V` / `lineEdit_P101_H_V` | `lineEdit_P101_L_P` / `lineEdit_P101_H_P` |
| Temperature T-101 | `lineEdit_T101_L_V` / `lineEdit_T101_H_V` | `lineEdit_T101_L_P` / `lineEdit_T101_H_P` |
| pH | `lineEdit_pH_L_V` / `lineEdit_pH_H_V` | `lineEdit_pH_L_P` / `lineEdit_pH_H_P` |

### Displays

| Widget | Shows | Updated by |
|---|---|---|
| `label_P101` | Pressure (1 decimal) | `backgroundThread` |
| `label_T101` | Temperature | `backgroundThread` |
| `label_pH` | pH | `backgroundThread` |
| `label_NDIR` | CO₂ ppm | `backgroundThread_2` |
| `labelLS101` | Level switch 101 image | `backgroundThread` (`204`) |
| `labelLS102` | Level switch 102 image | `backgroundThread` (`204`) |
| `MplWidget` | Pressure trend | `update_graph` |
| `MplWidget_2` | Temperature trend | `update_graph` |
| `MplWidget_3` | CO₂ trend | `update_graph` |
| `MplWidget_4` | pH trend | `update_graph` |

### NDIR calibration

| Widget | Handler | Command (NDIR port) |
|---|---|---|
| `pushButton_Fresh` | `calibration_FreshAir` | `112;1;1;1;1;1;e` |
| `pushButton_N2` | `calibration_N2` | `113;1;1;1;1;1;e` |
| `pushButton_KG` + `lineEdit_KG` | `calibration_KG` | `114;{ppm};1;1;1;e` |

### Modes and alarm

| Widget | Label in UI | Handler |
|---|---|---|
| `radioButton` | Manual | `set_manual_mode` |
| `radioButton_2` | Absorption | `set_absorption_mode` |
| `radioButton_3` | Desorption | `set_desorption_mode` |
| `pushButton_Alarm` | Alarm toggle | `alarm_function` |

### Data table

| Widget | Handler |
|---|---|
| `tableWidget` | Filled by `update_table` |
| `saveButton` | `save_table_as_csv` |
| `clearButton` | `clear_table` |

### Analysis containers (plain QWidgets that get a Matplotlib canvas added)

| Absorption tab | Desorption tab | Contents |
|---|---|---|
| `graphWidget_abRaw` | `graphWidget_deRaw` | Raw CO₂ |
| `graphWidget_abSmooth` | `graphWidget_deSmooth` | EMA-smoothed CO₂ |
| `graphWidget_abLogistic` | `graphWidget_deLogistic` | Logistic regression probability |
| `graphWidget_abLogisticDerivative` | `graphWidget_deLogisticDerivative` | p·(1−p) |

### Widgets in the .ui that the code never uses

`checkBox`, `label_alarm`, the numbered `label_*` captions, the group boxes, and the tabs `tab`, `tab_2`, `tab_4`, `tab_8`, `tab_9` inside `visualization`.

---

## 5. Serial Communication

### Connect flow (`Connection` / `Connection_2`, the two are identical)

```
click Connect
  │
  ├─ isConnecting? → ignore (stops double-clicks)
  ├─ disable button, isConnecting = True
  │
  ├─ ConnectionStatus == 0  (not connected)
  │     port = textEdit text (stripped)
  │     empty → ValueError
  │     status label "Connecting..." (orange)
  │     serial.Serial(port, 115200, timeout=0.5, write_timeout=1)
  │     ConnectionStatus = 1, isRun = True
  │     readSerialStart()  → starts the daemon reader thread
  │     button text "Disconnect", port box disabled
  │     status label "Connected" (green)
  │
  ├─ else → disconnect_primary() / disconnect_secondary()
  │
  ├─ on SerialException / OSError / ValueError:
  │     close a half-opened port, reset all state
  │     status label "Failed to connect" (red)
  │     QMessageBox warning
  │
  └─ finally: isConnecting = False, button enabled again
```

### Disconnect flow (`disconnect_primary` / `disconnect_secondary`)

1. Set `isRun = False` so the reader loop exits.
2. Close the port. This unblocks a `readline()` that is waiting.
3. `thread.join(timeout=1.0)`. Prints a warning if the thread is still alive.
4. Set the thread and connection to `None` and reset the status.
5. Reset the UI to "Connect" with the status label "Disconnected" (red).

### Reader threads

**`backgroundThread`** (primary):
- Waits 1 s, then checks the port is open and clears the input buffer.
- Loop while `isRun`:
  - `readline()`. An empty result means a timeout, so it loops again.
  - On a serial error: print it (unless this was a user disconnect) and exit.
  - Strips the last 2 bytes (assumes `\r\n`), decodes as UTF-8, prints it, and splits on `;`.
  - `203` → scales P, T, pH (see §7) → buffers, labels → `check_anomaly(T, P)`.
  - `204` → level-switch images + heater power.
  - `isReceiving = True`.
- **Parse errors are not caught** (see bug #7).

**`backgroundThread_2`** (NDIR):
- Same setup.
- `rstrip(b"\r\n")`, decodes with `errors="ignore"`, splits on `,`.
- Needs at least 4 fields. `x[3]` is the CO₂ ppm.
- Appends to `y_var5` and updates `label_NDIR`.
- On a `ValueError` or `IndexError`, it repeats the previous value so the buffer keeps moving.
- Prints `"CO2 serial reader thread stopped."` when it exits.

`readSerialStart` / `readSerialStart_2` won't start a second thread if one is already running.

---

## 6. Serial Protocol Reference

All messages are ASCII, `;`-separated, and end with `;e`. Python floats are sent through `str()` (for example `"2.5"`).

### PC → Primary controller (COM4)

| Code | Format | Meaning |
|---|---|---|
| `113` | `113;1;{channel};{state};e` | Digital output. `state` 1 = on/open, 0 = off/closed |
| `226` | `226;1;{raw_setpoint};0;e` | Heater setpoint as a raw (sensor-scale) value |
| `227` | `227;1;{M};{P};{I};{D};e` | PID parameters |

**Digital output channels (code 113):**

| Channel | Device |
|---|---|
| 1 | Vacuum pump |
| 2 | ABV-101 |
| 3 | ABV-102 |
| 4 | ABV-103 |
| 5 | ABV-104 |
| 6 | ABV-105 |
| 7 | Heater enable |

### PC → NDIR (COM6)

| Code | Format | Meaning |
|---|---|---|
| `112` | `112;1;1;1;1;1;e` | Fresh-air calibration |
| `113` | `113;1;1;1;1;1;e` | N₂ zero calibration (same code as the digital output command, but on a different device) |
| `114` | `114;{known_ppm};1;1;1;e` | Known-gas span calibration |

### Primary controller → PC

| Code | Format | Fields |
|---|---|---|
| `203` | `203;{rawP};{rawT};{rawpH}` | Analog readings, scaled on the PC |
| `204` | `204;{heaterPower};{LS102};{LS101}` | Heater output, level switches (0 → red image, 1 → green image) |

### NDIR → PC

Comma-separated line. Field index 3 (the 4th field) = CO₂ in ppm. The other fields are ignored.

---

## 7. Sensor Scaling (Calibration)

Each analog value is scaled with a straight line between two calibration points:

```
fraction = (raw − L_V) / (H_V − L_V)
value    = fraction × (H_P − L_P) + L_P
```

| Sensor | Extra step | Buffer |
|---|---|---|
| Pressure P-101 | **Divided by 10** after scaling (probably a unit conversion, e.g. kPa→bar; the reason isn't documented) | `y_var2` |
| Temperature T-101 | none | `y_var3` |
| pH | none | `y_var4` |

### Heater setpoint (reverse direction)

`pushButton_Heater_ON_function` converts the °C setpoint into a raw value using the **T-101** calibration in reverse:

```
fraction = (SV − T101_L_P) / (T101_H_P − T101_L_P)
raw      = fraction × (T101_H_V − T101_L_V) + T101_L_V
```

That raw value is sent as `226;1;{raw};0;e`. So the controller's PID compares raw sensor values, not °C.

**The calibration values are read from the line edits on every message.** If one is empty or not a number, `float()` raises an error. Inside the reader thread, that kills the thread (bug #7).

---

## 8. Data Flow and Buffers

### Rolling buffers

Each buffer is a numpy array of length 200. To add a value: `np.append(buf, new)[1:201]`, which drops the oldest value.

| Buffer | Sensor | Written by | Chart | Chart title | Table column |
|---|---|---|---|---|---|
| `y_var2` | P-101 pressure [barg] | Thread 1 (`203`) | `MplWidget` | "Pressure, barg" | 3 |
| `y_var3` | T-101 temperature [°C] | Thread 1 (`203`) | `MplWidget_2` | "Temperature, C" | 2 |
| `y_var4` | pH | Thread 1 (`203`) | `MplWidget_4` | "pH" | 4 |
| `y_var5` | CO₂ [ppm] | Thread 2 | `MplWidget_3` | "CO2, ppm" | 5 |

The chart x-axis is `np.linspace(-100, 0, 200)`, a fixed axis that is **not** in seconds. Samples come in at the controller's rate, but the charts redraw every 1 s.

Latest values are also stored in `number_P101`, `number_T101`, `number_pH` and `number_heatout`. These are read as `buf[199]` (hardcoded instead of `[-1]`).

### End-to-end path of one pressure reading

```
Controller sends "203;512;300;700\r\n"
  → Thread 1 readline → decode → split
  → scaled with P101 calibration ÷ 10 → y_var2 → label_P101
  → check_anomaly(T, P)                         (thread 1)
  ... up to 1 s later ...
  → timerplot → update_graph → MplWidget redraw
  → check_anomaly(T, P)                         (GUI thread, runs again)
  → update_table → new row (P in column 3)
  ... co2_timer ...
  → visualizationAB/DE_graph reads column 5 (CO₂ only)
```

---

## 9. Timers and Periodic Work

| Timer | Interval | Created | Callback | Notes |
|---|---|---|---|---|
| `timerplot` (local variable, kept alive because its parent is `self`) | 1000 ms | `__init__` | `update_graph` | Always running, even when nothing is connected |
| `self.co2_timer` | 1000 ms | First Absorption/Desorption click | `visualizationAB_graph` or `visualizationDE_graph` | Switching modes disconnects and reconnects the callback. **Manual mode doesn't stop it**, so it keeps drawing the last mode's charts |

### `update_graph` (every 1 s)

1. Redraws the 4 MplWidgets from the buffers.
2. `check_anomaly(y_var3[-1], y_var2[-1])`.
3. `update_table()` adds a row.

---

## 10. Operating Modes

The mode is stored in two flags: `is_absorption_mode` and `is_desorption_mode`.

| Mode | Flags | Set by |
|---|---|---|
| Manual | both False | `radioButton` → `set_manual_mode` (only sets flags, doesn't touch hardware) |
| Absorption | abs=True | `radioButton_2` → `set_absorption_mode` |
| Desorption | des=True | `radioButton_3` → `set_desorption_mode` |

### `set_absorption_mode` / `set_desorption_mode`

1. Set the flags.
2. Build the analysis canvases the first time (`ab_graph_initialized` / `de_graph_initialized`).
3. Draw the analysis charts once straight away.
4. Create `co2_timer` or point it at this mode's draw function.
5. Call `absorption_mode()` / `desorption_mode()`.

### Valve patterns (from `SorptionMode.py`)

| Valve | Absorption | Desorption |
|---|---|---|
| ABV-101 | OPEN | OPEN |
| ABV-102 | OPEN | CLOSED |
| ABV-103 | CLOSED | CLOSED |
| ABV-104 | CLOSED | OPEN |
| ABV-105 | OPEN | CLOSED |
| Pump | ON (`pushButton_PumpON_function`) | OFF (`pushButton_PumpOFF_function`) |
| Heater | ON with the current `lineEdit_Tem_SV` (`pushButton_Heater_ON_function`) | **`pushButton_Heater_Set_function()`: doesn't exist, crashes** |

`SorptionMode` calls `setChecked()` and then calls the valve function directly. `setChecked` doesn't emit `clicked`, so each valve command is sent only once.

### Mode change timing

Each valve function calls `time.sleep(0.1)` twice. Five valves plus the pump and heater freeze the GUI for about **1.5 s** on every mode change.

### What `check_safety_conditions` *would* check (it is never called)

| Mode | Raises an alarm if |
|---|---|
| Absorption | any of ABV-101..105 is **unchecked**, or pump is off |
| Desorption | any of ABV-101..105 is **checked**, or pump is on |

These rules don't match the `SorptionMode` patterns. Absorption closes ABV-103 and ABV-104, and Desorption opens ABV-101 and ABV-104. So if this check were switched on as written, it would raise alarms straight after every mode change.

---

## 11. Alarm and Anomaly System

There are two separate alarm paths, each with its own Telegram bot.

### a) Anomaly alarm (sensor limits)

```
pushButton_Alarm → alarm_function()
    toggles alarm_enabled; when switched on, reloads the threshold CSVs

check_anomaly(T, P)   ← called from update_graph (GUI) AND backgroundThread (thread 1)
    return if not alarm_enabled
    Absorption: if  T_low ≤ T ≤ T_high  AND  P_low ≤ P ≤ P_high:      ← INSIDE the limits
        send_telegram_message("Absorption", T, P)    ← wrong arguments
        save_anomaly_details("Absorption", T, P)     → anomaly_details.csv
        triggerAnomalyAlert("Absorption", T, P)      → Telegram (anomaly bot) + sound
    Desorption: same, with the desorption limits
```

**The condition is backwards.** It alerts when the values are *normal*. The intended check is `not (low ≤ x ≤ high)`.

### b) Safety alarm (valve/pump state)

```
check_safety_conditions()      ← never called
  → triggerSafetyAlarm(msg)
       fires only once (safety_alarm_triggered is never reset)
       Telegram (safety bot)
```

### `ThresholdAD` and the threshold loading

```python
class ThresholdAD:          # just stores low and high
    low, high

initialize_thresholds()
  thresholds_csv(file) → DataFrame or None (prints if the file is missing)
  ThresholdDetector(df, "temperature" | "pressure") → ThresholdAD(min, max)
  sets threshold_absorption_temp/pres, threshold_desorption_temp/pres
```

If a CSV is missing, those attributes are never created, so `check_anomaly` raises an AttributeError.

### Telegram

```python
requests.get(f"https://api.telegram.org/bot{token}/sendMessage?chat_id={id}&text={message}")
```

- Blocking call with **no timeout**, made on the GUI thread or the serial thread.
- The message is put straight into the URL. A `&` or `#` in it would cut it short. Use `params={...}` instead.
- Every call also plays the alarm sound, so `triggerAnomalyAlert` plays it **twice** (once in `send_telegram_message`, once directly).
- Bot tokens are hardcoded in the source (lines 194–197).

---

## 12. CO₂ Analysis Plots (Absorption / Desorption tabs)

`setup_ABvisualization_graph` and `setup_DEvisualization_graph` are the same apart from the attribute and widget names. Each one:

1. Creates 4 `FigureCanvas(Figure())` objects, each with one subplot.
2. Sets an Expanding size policy and minimum sizes (110×195 / 1×190 / 1×185).
3. Gets or creates a `QVBoxLayout` on the `graphWidget_*` container, clears any old widgets, and adds the canvas with no margins.

`visualizationAB_graph` and `visualizationDE_graph` are also the same apart from names. Every second they:

1. **Read the whole table**: column 1 (Time) and column 5 (CO₂). Rows that aren't numbers are skipped.
2. Return early (and print `"No table data to plot."`) if the table is empty.
3. Use the row number as the x-axis.
4. **Raw plot**: CO₂ against row number (green).
5. **EMA**: `df["CO2[ppm]"].ewm(span=10, adjust=False).mean()` (blue).
6. **Logistic regression**:
   - labels = `EMA > mean(EMA)` → 0/1
   - if only one class is present → flat gray line at 0
   - otherwise fit `LogisticRegression()` on (row number → label) and plot `P(label=1)` (orange), with the y-limits set to 0–1
7. **"Derivative"**: plots `p·(1−p)` (red), y-limits 0–0.3.

### What the analysis actually tells you

- The regression fits a single S-curve to the question "when does CO₂ go above its average?". The middle of the curve estimates when the CO₂ step happened (breakthrough in absorption, release in desorption).
- `p·(1−p)` is the sigmoid's derivative **without the slope coefficient β**. The real derivative is `β·p·(1−p)`, so the shape and peak position are correct but the height isn't. The fixed 0–0.3 y-limit fits `p(1−p)`, whose maximum is 0.25.
- The y-axis labels on the probability and derivative plots say "CO₂ [ppm]". They should be "Probability" and "dp/dt".
- It uses **every row in the table**, including the zero rows from before connecting and rows from other modes. Press Clear before a run to get a clean analysis.
- Fitting on the full table every second gets slower as the table grows (bug #8).

---

## 13. Table Logging and CSV Export

### `update_table` (every 1 s)

| Col | Header | Source |
|---|---|---|
| 0 | Date | `QDateTime` `yyyy-MM-dd` |
| 1 | Time | `HH:mm:ss` |
| 2 | T-101[C] | `y_var3[-1]`, 2 decimals |
| 3 | P-101[barg] | `y_var2[-1]` |
| 4 | pH-101[-] | `y_var4[-1]` |
| 5 | CO2[ppm] | `y_var5[-1]` |
| 6 | Mode | "Absorption" / "Desorption" / "Manual" |

Column widths are 95 px each, and the Date column is 200 px.

The table gets a row whether or not anything is connected, and the values are just the last buffer value. If a sensor stops sending, its last value is repeated.

### `save_table_as_csv`

- Opens a save dialog with the default path `C:/data.csv`.
- Writes the header row and every row as text.
- Prints success or failure (no dialog box).

### `clear_table`

`setRowCount(0)`.

---

## 14. Method Reference

| Method | Line | Called by | What it does |
|---|---|---|---|
| `__init__` | 65 | `__main__` | Loads the UI, connects signals, sets up state and timers |
| `calibration_KG` | 215 | `pushButton_KG` | NDIR known-gas calibration (`114`) |
| `calibration_N2` | 227 | `pushButton_N2` | NDIR zero calibration (`113`) |
| `calibration_FreshAir` | 235 | `pushButton_Fresh` | NDIR fresh-air calibration (`112`) |
| `thresholds_csv` | 243 | `initialize_thresholds` | Reads a CSV into a DataFrame, or returns None |
| `alarm_function` | 251 | `pushButton_Alarm` | Toggles `alarm_enabled`; reloads thresholds when switched on |
| `initialize_thresholds` | 260 | `__init__`, `alarm_function` | Builds the 4 `ThresholdAD` objects |
| `ThresholdDetector` | 280 | `initialize_thresholds` | Looks up min/max for one parameter |
| `save_table_as_csv` | 289 | `saveButton` | Exports the table |
| `set_absorption_mode` | 319 | `radioButton_2` | Flags, analysis charts, timer, valves/pump/heater |
| `set_desorption_mode` | 347 | `radioButton_3` | Same for Desorption |
| `set_manual_mode` | 375 | `radioButton` | Clears the flags |
| `absorption_mode` | 380 | `set_absorption_mode` | `AbsorptionMode(self)`, pump ON, heater ON |
| `desorption_mode` | 393 | `set_desorption_mode` | `DesorptionMode(self)`, pump OFF, **missing heater function** |
| `check_safety_conditions` | 406 | **nobody** | Valve/pump state check |
| `triggerSafetyAlarm` | 445 | `check_safety_conditions` | One-time Telegram safety alert |
| `check_anomaly` | 462 | `update_graph`, `backgroundThread` | Threshold check (backwards) |
| `save_anomaly_details` | 494 | `check_anomaly` | Appends to `anomaly_details.csv` |
| `triggerAnomalyAlert` | 500 | `check_anomaly` | Telegram (anomaly bot) + sound |
| `send_telegram_message` | 517 | several | HTTP GET to Telegram + sound |
| `ABV_101_function` … `ABV_105_function` | 526–614 | Valve buttons, `SorptionMode` | Sends `113;1;{2..6};{0/1};e`, updates the icon |
| `pushButton_Heater_PID_function` | 637 | `pushButton_Heater_PID` | Sends `227` |
| `pushButton_PumpON_function` | 656 | Button, `absorption_mode` | Swaps button states, sends `113;1;1;1;e` (in try) |
| `pushButton_PumpOFF_function` | 669 | Button, `desorption_mode` | Swaps button states, sends `113;1;1;0;e` (**no try**) |
| `pushButton_Heater_ON_function` | 677 | Button, `absorption_mode` | Converts the setpoint, sends `226` + `113;1;7;1;e` (**no try**) |
| `pushButton_Heater_OFF_function` | 698 | Button | Sends `226;1;0;0;e` + `113;1;7;0;e` (**no try**) |
| `setup_ABvisualization_graph` | 716 | `set_absorption_mode` (once) | Builds the 4 absorption canvases |
| `visualizationAB_graph` | 838 | `set_absorption_mode`, `co2_timer` | Raw / EMA / logistic / derivative plots |
| `setup_DEvisualization_graph` | 951 | `set_desorption_mode` (once) | Builds the 4 desorption canvases |
| `visualizationDE_graph` | 1073 | `set_desorption_mode`, `co2_timer` | Same plots for Desorption |
| `update_graph` | 1186 | `timerplot` | 4 trend charts + anomaly check + table row |
| `update_table` | 1215 | `update_graph` | Adds a row |
| `clear_table` | 1249 | `clearButton` | Empties the table |
| `backgroundThread` | 1252 | Thread 1 | Primary serial reader |
| `backgroundThread_2` | 1368 | Thread 2 | NDIR serial reader |
| `Connection` | 1447 | `Connect` | Connect/disconnect primary |
| `disconnect_primary` | 1525 | `Connection` | Primary shutdown |
| `Connection_2` | 1557 | `Connect_2` | Connect/disconnect NDIR |
| `disconnect_secondary` | 1636 | `Connection_2` | NDIR shutdown |
| `readSerialStart` | 1665 | `Connection` | Starts thread 1 |
| `readSerialStart_2` | 1678 | `Connection_2` | Starts thread 2 |
| `close` | 1690 | **nobody** (replaces `QMainWindow.close`) | Stops thread 1, closes primary port |

---

## 15. Instance State Reference

| Attribute | Type | Meaning |
|---|---|---|
| `sensorL`, `sensorH` | QPixmap | Green / red level-switch images |
| `plot_window` | int (200) | Buffer length |
| `y_var2..y_var5` | np.ndarray[200] | P, T, pH, CO₂ buffers |
| `ConnectionStatus`, `_2` | int 0/1 | Link connected |
| `serialConnection`, `_2` | `serial.Serial` or None | Port handle |
| `thread`, `thread_2` | `Thread` or None | Reader thread |
| `isRun`, `_2` | bool | Reader loop keeps running while True |
| `isReceiving`, `_2` | bool | A valid packet has arrived (set but never read) |
| `isConnecting`, `_2` | bool | Stops repeat clicks during connect |
| `is_absorption_mode`, `is_desorption_mode` | bool | Current mode |
| `safety_alarm_triggered` | bool | One-shot latch, never reset |
| `alarm_enabled` | bool | Anomaly alarm on/off |
| `threshold_{absorption,desorption}_{temp,pres}` | ThresholdAD | Limits |
| `anomaly_bot_token`, `anomaly_chat_id` | str | Telegram (anomaly) |
| `safety_bot_token`, `safety_chat_id` | str | Telegram (safety) |
| `number_P101`, `number_T101`, `number_pH`, `number_heatout` | float | Latest values |
| `Heater_P/I/D/M` | float | Last PID values sent |
| `co2_timer` | QTimer | Analysis refresh (created on first mode switch) |
| `ab_graph_initialized`, `de_graph_initialized` | bool | Analysis canvases have been built |
| `co2_canvas_*`, `ax_co2*`, `de_co2_canvas_*`, `ax_de_co2*` | Matplotlib | Analysis canvases and axes |
| `Sequence_isRun` | bool | Only set in `close()`, left over from older code |

---

## 16. Threading Model

| Thread | Runs | Touches |
|---|---|---|
| GUI (main) | Event loop, button handlers, both timers | Everything |
| Thread 1 (daemon) | `backgroundThread` | Reads `serialConnection`; writes `y_var2/3/4`; **calls `setText`/`setPixmap` on labels and reads `lineEdit.text()`**; calls `check_anomaly` (→ HTTP request, `QSound`, file write) |
| Thread 2 (daemon) | `backgroundThread_2` | Reads `serialConnection_2`; writes `y_var5`; **calls `label_NDIR.setText`** |

Problems:

- **Qt widgets must only be touched from the GUI thread.** Changing labels from worker threads works most of the time but can crash at random or leave the screen half-drawn. The fix: define a `pyqtSignal` (or use `QMetaObject.invokeMethod`) and update widgets in a slot on the GUI thread.
- The buffers are replaced rather than changed in place, so swapping in a new array is atomic under the GIL. A reader always gets a complete array. This part is OK.
- Both threads and the GUI thread can **write to the same serial port** at once. For example, a valve command from the GUI while thread 1 is reading. Reading and writing at the same time is fine in pyserial. Writes all happen on the GUI thread, so they don't overlap each other.
- Daemon threads stop when the process exits, but the ports aren't closed cleanly on window close (nothing connects `closeEvent`).

---

## 17. Known Bugs and Risks

Ranked by severity. Line numbers refer to `MainUI_v3.py`.

### 1. Desorption mode crashes the app (`:403`)
`desorption_mode()` calls `self.pushButton_Heater_Set_function()`, which isn't defined anywhere. The valves and pump have already been switched by then. An unhandled error inside a PyQt5 (≥5.5) click handler aborts the process.
**Fix:** call `pushButton_Heater_OFF_function()` (or `_ON_`, whichever desorption needs), or write the missing method.

### 2. Anomaly check is backwards and sends a broken message (`:468-492`)
- It alerts when T and P are **inside** the limits.
- `send_telegram_message("Absorption", temperature, pressure)` uses the mode name as the bot token and the temperature as the chat ID, so the request goes to a bad URL.
- It runs from both the GUI timer and thread 1, so with the alarm on there are about 4 HTTP calls and 4 beeps per second during normal running. The GUI freezes because `requests.get` has no timeout.

**Fix:** `if not (low <= T <= high) or not (low <= P <= high):`, remove the stray `send_telegram_message` call, call it from one place only, and add a cooldown.

### 3. Safety alarm is never called (`:406`)
`check_safety_conditions` has no caller. Its rules also don't match the `SorptionMode` valve patterns (§10), and `safety_alarm_triggered` is never reset.

### 4. Telegram bot tokens are in source and git history (`:194-197`)
Anyone with access to the repo can control the bots. **Revoke them with @BotFather** and load them from an env var or an untracked config file.

### 5. Commands crash when the port isn't connected
`PumpOFF`, `Heater_ON`, `Heater_OFF` and `Heater_PID` call `self.serialConnection.write` with no `try`. When `serialConnection` is `None` → AttributeError → crash. Clicking Absorption before connecting crashes at the Heater ON step. `float(lineEdit.text())` with an empty box also crashes.

### 6. Widgets are updated from worker threads
See §16.

### 7. Primary reader thread dies on one bad line (`:1287-1357`)
- `ser_bytes2[0:len-2]` assumes the line ends in `\r\n`.
- `.decode("utf-8")` has no error handling.
- `float(x[1..3])` and the calibration `float()` calls aren't caught.
- `x[3]` on a short `204` packet raises an IndexError.

Any of these ends the thread. The UI still says "Connected" but nothing updates. `backgroundThread_2` already handles all of this, so copy its approach.

### 8. Gets slower the longer it runs
- `tableWidget` gets a row every second forever, about 86,400 rows a day.
- `visualizationAB/DE_graph` re-reads every row, rebuilds a DataFrame, refits `LogisticRegression` and redraws 4 figures **every second on the GUI thread**.
- The zero rows from before connecting are included in the analysis.

**Fix:** keep the data in a list or deque instead of reading the table back, limit the table size, and refresh the analysis less often.

### 9. Platform-specific paths
- `QPixmap("./L_GREEN.jpg")` but the files are `L_GREEN.JPG`. Linux/WSL file names are case-sensitive, so the level-switch images are blank there.
- The `QSound` path `C:/mini adsorption rig alarm/...` is Windows-only. The repo already has `alarm_beep.wav`, so use that relative path.
- `loadUi("ui_MainUI_v3.ui")` and the icon paths are relative to the **current folder**, not to the script. Running from somewhere else fails. Use `os.path.dirname(__file__)`.

### 10. Smaller issues
- `widget().setParent(None)` at `:767` and `:1004`: `widget` is already the widget, so calling it raises a TypeError. This only matters if the container already has a layout with widgets in it.
- `close()` at `:1690` replaces Qt's own `close()`. It calls `self.thread.join()` without checking for None, doesn't close port 2, and nothing calls it. Move the cleanup into `closeEvent(self, event)`.
- `[199]` is hardcoded in `backgroundThread`. Use `[-1]`.
- If a threshold CSV is missing, `check_anomaly` raises an AttributeError.
- The anomaly message says "PSI" but the pressure is in barg.
- `triggerAnomalyAlert` plays the sound twice.
- Probability and derivative plots have the y-label "CO₂ [ppm]".
- Manual mode doesn't stop `co2_timer`.
- `isReceiving` / `isReceiving_2` are set but never read.
- Window title "D2O batch SCADA system".
- The Telegram message isn't URL-encoded (use `params=`).
- The comments `# Vaccum` on the heater writes and `# Pressure PIT802/803` on the temperature/pH buffers are copy-paste mistakes.

### 11. Tests don't match this file
`my_unittest.py` imports `CUASinterface` from `miniAbsorp2` and then from `MainUI_v3`, and the second import wins. It then:
- calls `self.app.triggerAlert(...)`, which is now `triggerAnomalyAlert`, so those tests raise an AttributeError
- patches `miniAbsorp2.QSound.play`, so sound isn't mocked for `MainUI_v3`
- builds the real window, which needs a display and the `.ui` file in the current folder

---

## 18. Dead / Unused Code

| What | Where |
|---|---|
| Commented-out `y_var1`, `y_var6..y_var22` | `:100-122` |
| Commented-out `PIDControl_Heater_function` | `:617-635` |
| Commented-out `browsefuntion` | `:711-714` |
| Commented-out CO₂ timer setup in a string block | `:203-213` |
| `check_safety_conditions` / `triggerSafetyAlarm` | Defined, never called |
| `close()` | Never called |
| `isReceiving`, `isReceiving_2`, `Sequence_isRun` | Set, never read |
| Unused imports | See §1 |
| Unused widgets | See §4 |

---

## 19. Relationship to Other Files in the Repo

| File | Relationship |
|---|---|
| `SorptionMode.py` | Imported. Sets the valve patterns by calling back into `CUASinterface.ABV_10x_function` |
| `mplwidget.py` | Loaded through the `.ui` file as the custom `MplWidget` class |
| `ui_MainUI_v3.ui` | The layout. Replaced `ui_V1_alarm.ui` (see the comment at `:67`) |
| `miniAbsorp2.py` | The **older version** of this file (`CUASinterface` with `triggerAlert`). Still used by `test_miniAbsorp2.py`, `testBeep.py`, `testTelegram.py` and `test_unittest_module.py` |
| `my_unittest.py` | Tests meant for `MainUI_v3` (renamed from `unittest.py` so it doesn't hide the standard-library `unittest` module). Out of date, see bug #11 |
| `OpenCV-Solubility-Cell*.py`, `OpenCV-D2O.py` | Separate apps that also define a `CUASinterface` class. Same original template, not imported |
| `simulation*.py`, `scenarioTesting.py` | Separate simulation/testing scripts; they produce `simulation_*.csv` |
| `absorption_threshold.csv`, `desorption_threshold.csv` | Alarm limits |
| `anomaly_details.csv` | Written by `save_anomaly_details` |

---

## 20. Suggested Fix Priority

1. **Revoke and move the Telegram tokens** (security, already exposed in git history).
2. **Fix the missing `pushButton_Heater_Set_function`** (Desorption crash).
3. **Flip the `check_anomaly` condition**, remove the stray Telegram call, call it from one place, and add a cooldown and a request timeout.
4. **Add the connection guard to pump/heater/PID** (a shared `_send(cmd)` helper that checks for None and catches errors).
5. **Make `backgroundThread` handle bad lines** the way `backgroundThread_2` does.
6. **Move widget updates to the GUI thread** with signals.
7. Fix the platform paths (`L_GREEN.JPG` case, `QSound` path, paths relative to `__file__`).
8. Limit the table and stop refitting the analysis on the full table every second.
9. Decide whether the safety-condition check should exist. If yes, match its rules to `SorptionMode` and call it from `update_graph`.
10. Update `my_unittest.py` to match the current method names.
