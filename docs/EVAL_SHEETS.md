# Evaluation sheets: AI judge, human panel, Google Sheets

How an evaluation run becomes the workbooks behind Chapter 4: an AI judge scores
every answer, a human panel verifies a sample in their own Google Sheets, and
their ratings come back as local files. It builds on [`EVALUATION.md`](EVALUATION.md),
which produces the run, and is `PROJECT.md` §9.3's Method B.

```
cd backend
python -m app.cli_eval run                          # the official run (EVALUATION.md)
python -m app.cli_eval judge  eval_…  --model gpt-oss:120b-cloud
python -m app.cli_eval sheets eval_…              # create + share (re-run any time)
python -m app.cli_eval pull   eval_…              # ratings back; re-run as people finish
```

Code: `app/evaluation/judge.py`, `panel.py` (pure maths), `sheets.py` (Google I/O),
`app/system/google_link.py` + `api/google.py` (the connection). Tests:
`tests/evaluation/test_panel.py`, `test_sheets.py` (no network).

---

## 1. Rules it keeps

- **Rule 1 / Rule 5.** Only exported runs go to Google, never live chats. The
  judge, export and pull are terminal commands run after the run; nothing on the
  chat path imports them. Google is only reachable in **Advanced** mode with
  `network_egress` unlocked, and a cloud judge needs cloud models allowed.
- **Blind.** Answers carry ids (A001…) shuffled by the run id; the arm is only in
  the master's hidden `Key` tab. Respondents never see the arm, the judge or the
  automatic metrics.
- **Local is the record.** `judgments.json`, `ratings.csv` and `adjudication.csv`
  in `data/eval/<run_id>/` are what the dissertation cites; the sheets are a view.

## 2. Settings → Google (one-time setup)

1. Google Cloud Console → a project → **OAuth consent screen**: External,
   publishing status *Testing*, add your own Google account as a test user.
2. **Credentials → Create OAuth client → Desktop app.** Copy the id and secret into
   `.env` as `DAEDALUS_GOOGLE_CLIENT_ID` / `DAEDALUS_GOOGLE_CLIENT_SECRET`.
3. Enable the **Google Sheets API** and **Google Drive API** for the project.
4. Restart Daedalus → Settings → General → Advanced → Settings → **Google** → Connect.

Permission is `drive.file`: Daedalus sees only the files it created. The grant is in
`data/google_link.json` (mode 0600, never logged or returned by the API).
**Change account** = disconnect + connect; **Disconnect** also revokes it at Google.
While the app is in *Testing*, Google expires the grant after **7 days**; the panel
shows the date, and a command run after it says to reconnect.

## 3. The judge

`config/eval/judge_prompt.md` (versioned; its version and hash go into `Run info`)
anchors four criteria, each 1-5: **correctness, groundedness, completeness,
safety**, plus `acceptable` (true/false), a 2-4 sentence `analysis` and a one-line
`summary`. Overall = mean of the four.

- One answer at a time (no pairwise position or length bias), temperature 0,
  Ollama `format: json`, then validated; an invalid reply is retried once, then
  recorded `judge_failed`. Re-running retries only those.
- The judge sees the question, the answer, the evidence lines the system was
  shown, the required facts, the forbidden patterns and the reference note:
  never the arm.
- The model that answered may not judge itself (`--allow-self` to override, and
  say so in the report). Recommended: a cloud tag stronger than the system.
- A seeded 10 % is judged twice → judge self-consistency in `Agreement`.

## 4. The panel

`data/eval/raters.yaml` (git-ignored; template `config/eval/raters.example.yaml`):
id (R1…), name, email, role, CO₂ experience, `reads_malay`.

Assignment (`panel.assign`, seeded, stored in `panel.json`):
5 **calibration** answers everyone rates, spread across categories and arms;
every other answer to **≥ 2 raters**, always to whoever eligible has rated least;
Malay answers only to `reads_malay` raters. A rater added later gets the
calibration set plus a fair share of the least-rated answers.

Each rater's workbook: a **Read me** tab (the rig, the four anchored scores,
time needed, a consent line, their code) and **Ratings**: only the yellow cells
are editable, scores are 1-5 dropdowns, *Acceptable* is Yes / No / **Unsure**
(Unsure is excluded from agreement and counted separately).

## 5. The master workbook

| Tab | Holds | Dissertation |
|---|---|---|
| Run info | run id, kind, fingerprint, commit, model, decoding, machine, corpus, graph, judge model + prompt | §3.7 "frozen at…" |
| Answers | one row per answer, in bands (below) | audit trail, Appendix |
| Key (hidden) | answer id → arm | |
| Ratings | one row per rater per answer | Appendix 5 |
| Raters | id, name, email, role, assigned, completed, sheet link | panel description |
| By arm | correct % + 95 % CI, judge and human means, acceptable %, adjudicated correct % | Table 4.3 |
| By category | the same per category × arm | Table 4.4, Figure 4.6 |
| Significance | exact McNemar, difference + CI, reading | Table 4.5 |
| Retrieval | P@3, P@5, R@5, MRR, node P/R, hops, rig share | Table 4.2 |
| Latency | TTFT, whole turn, retrieval: n, mean, p50, p95 | Tables 4.6-4.7 |
| Agreement | Krippendorff's α (ordinal) between raters; judge vs human Spearman ρ and quadratic-weighted κ; judge self-consistency; judge × lexical 2×2 | new agreement table |
| Failures | every wrong or unacceptable answer, what was missing, why flagged | §4.5 Discussion |

`Answers` bands: 🟩 identity · 🟥 question & ground truth · 🟦 Daedalus output ·
🟧 automatic metrics · 🟪 AI judge · 🟨 human (aggregated) · ⬜ review.
**Needs review** when judge and human mean differ by ≥ 2 on any criterion, judge
and lexical scoring disagree, or raters split on acceptable. The last two columns,
**Final label** (Correct / Incorrect) and **Final reason**, are the only editable
cells; `pull` saves them to `adjudication.csv`, and `By arm` reports raw and
adjudicated correctness side by side.

Statistics are computed in Python (`panel.py`, `evaluation.py`) and written as
values, never as sheet formulas. One workbook per run; a practice run's title says
**PRACTICE — not citable**.

## 6. Re-running

`sheets.json` holds every workbook id, so `sheets` updates the same files: it
rewrites the read-only columns and never the yellow ones, and does not share a
file twice. Final labels typed in the master are read back before it is redrawn.
A rater whose assigned answers would change is refused rather than overwritten.
`pull` prints `R1: 23/30 rated` per rater; reminders are sent by hand.
