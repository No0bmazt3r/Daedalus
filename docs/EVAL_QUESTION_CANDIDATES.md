# Candidate eval questions: what operators actually ask during a run

Research notes, 2026-11-12. **Nothing here is in `config/eval/queries.yaml` yet.**
Adding a question is the author's decision, and must happen before the freeze
([`EVALUATION.md`](EVALUATION.md) §3).

## Why this exists

The 49 drafted questions are all about documents: limits, SOPs, calibration
steps. Operators running a sorption rig mostly ask about **the readings in front
of them**: is the solvent spent, is the sensor lying, did that run regenerate.
The set has no question that exercises the deterministic sensor tools against
real data. The sensor database now holds the real runs
(`data/new-samples/`, 128,955 rows), so these questions can be labelled
**exactly, by SQL, not from a draft document**.

## A finding that blocks the rig questions

The draft rig documents (`data/corpus_sources/rig/`, all marked DRAFT) describe an
**amine** reactor with limits of 45 °C, 2.5 barg, 600 ppm CO₂ and pH < 6. The real
data does not fit them:

| | Draft rig documents | Real runs (Jun–Jul) |
|---|---|---|
| Solvent | amine (MEA) | pH 12.6–13.9 in July, so caustic (NaOH-type); about pH 7 in the June runs; 9.7 on 30 Jul |
| Temperature | alarm > 45 °C | desorption runs at 74–96 °C |
| Pressure | design limit 2.5 barg | up to 15.3 barg on 14 Jul (offset or units? check with the lab) |
| CO₂ | alarm > 600 ppm | routinely 600–2,000 ppm; 579 readings sit at 2,000–2,001 ppm, the analyser's full scale |

All 11 `rig_specific: true` questions (Q01–Q03, Q09–Q12, Q18–Q21) is
labelled from those drafts. **Until the lab confirms the real solvent, limits and
instrument ranges, those labels may be wrong**, and a "correct" answer would only
mean "agreed with a placeholder". See memory note *lab-documents-tbc*.

## Common operator questions (from the literature)

What comes up in CO₂ absorption/desorption labs and pilot plants, and whether
Daedalus's corpus can answer it today:

| Theme | Typical question | Corpus today |
|---|---|---|
| Breakthrough | "Outlet CO₂ is climbing: is the solvent spent?" Breakthrough timing scales with the caustic available, and media is changed before first breakthrough ([patent](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8167979); [CHE451 lab](https://www.slideshare.net/slideshow/che451-co2-absorption-oral-report/55719991)) | Partly (Q20, amine framing) |
| pH as loading signal | "pH dropped fast: what happened?" In NaOH, pH falls as hydroxide is consumed, e.g. 13.07 → 7.02 in 1.5 min at 7 L/min ([Processes 2025](https://mdpi-res.com/d_attachment/processes/processes-13-01259/article_deploy/processes-13-01259.pdf)) | Amine framing only (Q19), wrong chemistry for this rig |
| Flow vs capacity | "Should I lower the gas flow?" Lower flow gives higher capacity; higher flow gives a steeper mass-transfer zone ([CHE451 lab](https://www.slideshare.net/slideshow/che451-co2-absorption-oral-report/55719991)) | No |
| NDIR sensor trust | "CO₂ reading is unstable or high: is the sensor wrong?" Condensation and humidity, baseline drift, and auto-baseline misbehaving when the space never reaches about 400 ppm ([Vaisala](https://docs.vaisala.com/r/M211897EN-E/en-US/GUID-62F80BAF-8B6A-47C5-916A-3318AD01CDD8); [Belimo](https://belimo.com/us/en_US/about/media/highlights/hvac-air-quality-sensor/co2/sensing); [Disruptive](https://support.disruptive-technologies.com/hc/en-us/articles/19515087433244-CO2-Sensor-troubleshooting)) | Yes (Q11, Q22) |
| Sensor full scale | "CO₂ is stuck at 2,000: is that real?" | No, and the real data has it |
| Regeneration | "Is desorption hot enough to regenerate?" Amine regeneration is typically 100–140 °C ([patent](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9707512)); erratic stripper temperature and pressure suggests foaming ([TCM](https://tcmda.com/publication/collection-02-operational-experience-results?ch=6)) | No, and amine-specific |
| Calibration before a run | "Calibrate pH and CO₂ first?" Standard lab practice ([CHE451 lab](https://www.slideshare.net/slideshow/che451-co2-absorption-oral-report/55719991)) | Yes (Q11, Q17) |

## Candidate live-reading questions, labelled from the real data

Times are Malaysia time (UTC+8). Values are from `sensor_readings.db` **after the
+1-year date shift** (real collection: 2025). "Day" means the whole local day,
which is what a model asking for "15 July" will most likely query. Key-fact
patterns leave room for rounding.

| # | Question | Exact answer | Suggested `key_facts` | Category |
|---|---|---|---|---|
| S1 | What was the highest CO₂ reading on 15 July 2026? | 2,001 ppm (absorption) | `200[01]` | single_hop_factual |
| S2 | What was the average reactor temperature on 16 July 2026? | 90.6 °C (day); 90.8 °C (desorption only) | `90\.[5-9]\|91` | single_hop_factual |
| S3 | What was the peak temperature during desorption on 16 July 2026? | 96.3 °C | `96\.[2-4]` | single_hop_factual |
| S4 | What was the lowest pH on 24 July 2026? | 12.59 | `12\.5[89]\|12\.6` | single_hop_factual |
| S5 | What is the most recent reading? | 30 Jul 2026 15:44:29: 89.2 °C, 0.04 barg, pH 9.83, 670.1 ppm, Desorption | `9\.8`, `670`, `89` | single_hop_factual |
| S6 | What was the maximum pressure on 14 July 2026? | 15.3 barg (absorption) | `15\.3` | single_hop_factual |
| S7 | The CO₂ reading sat at about 2,000 ppm for minutes on 15 July. Is that a real concentration? | Answer must flag full-scale/saturation and not report 2,000 as the true value. **Needs the analyser's range in the corpus first** | `saturat\|full.?scale\|range\|maximum` | multi_hop_causal |
| S8 | pH was about 13.5 in mid-July but 9.8 on 30 July. What does that suggest about the solvent? | Hydroxide largely consumed (loaded or spent); needs the real solvent confirmed | `consum\|spent\|loaded\|carbonat` | multi_hop_causal |
| S9 | Was the reactor running normally on 22 July? | Ambiguous: should ask which reading or limit, or answer only from readings | (scored on refusal or groundedness) | ambiguous |

S1–S6 can be added as soon as the time-zone note below is handled. S7–S8 need the
lab's own documents (analyser range, solvent) in the corpus first, or they are
out-of-corpus by construction.

## Before adopting any S-question

- **Pin the time zone.** `.env` has no `DAEDALUS_TZ`, so "15 July" is interpreted in
  the machine's zone. A laptop in another zone would query a different window. Set
  `DAEDALUS_TZ=Asia/Kuala_Lumpur` on both machines, then re-pack.
- **Write it into the dissertation:** the readings were collected in Jun–Jul 2025 and
  shifted +1 year in the database. Question dates refer to the shifted data.
