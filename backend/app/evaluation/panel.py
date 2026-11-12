"""The human panel and the judge, as plain data: docs/EVAL_SHEETS.md.

Pure functions, no network: blind answer ids, the rater assignment, and the
agreement statistics the `Agreement` tab reports. `sheets.py` does the Google I/O.

- Answer ids (A001…) hide the arm. The key is deterministic from the run id, so
  it never needs storing and every export of one run agrees.
- Assignment: a few calibration answers everyone rates, the rest spread so each
  answer has at least `per_answer` raters and loads stay even. Seeded.
- Agreement: Krippendorff's alpha (missing ratings allowed), Spearman's rho and
  quadratic-weighted Cohen's kappa. Implemented here (a few lines each) rather
  than adding scipy/sklearn for three formulas; checked against published values
  in tests/evaluation/test_panel.py.
"""

from __future__ import annotations

import math
import random
from collections import Counter, defaultdict
from typing import Any, Callable, Iterable

CRITERIA = ("correctness", "groundedness", "completeness", "safety")
SCALE = (1, 2, 3, 4, 5)
CALIBRATION = 5      # answers every rater sees
PER_ANSWER = 2       # minimum human ratings per answer
REVIEW_GAP = 2.0     # judge vs human mean, on any criterion, that needs a look


# ── blind ids ────────────────────────────────────────────────────────────────


def answer_keys(record: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """answer id -> (arm, question id), shuffled by the run id so the order says nothing."""
    pairs = sorted((arm, r["id"]) for arm, rows in record["results"].items() for r in rows)
    random.Random(record["run_id"]).shuffle(pairs)
    return {f"A{n:03d}": pair for n, pair in enumerate(pairs, 1)}


# ── assignment ───────────────────────────────────────────────────────────────


def assign(answers: list[dict[str, Any]], raters: list[dict[str, Any]], *, seed: str,
           calibration: int = CALIBRATION, per_answer: int = PER_ANSWER) -> dict[str, list[str]]:
    """rater id -> answer ids. `answers` carry `answer_id`, `category`, `arm`, `language`.

    Calibration answers are spread over categories and arms and need nobody to
    read Malay. A Malay answer only goes to raters with `reads_malay`. Every other
    answer gets `per_answer` raters (fewer only when too few can read it),
    always to whoever eligible has the fewest so far.
    """
    if not raters:
        raise ValueError("no raters")
    rng = random.Random(seed)
    pool = sorted(answers, key=lambda a: a["answer_id"])
    rng.shuffle(pool)

    calib: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for a in pool:  # one per (category, arm) first, so the calibration set is varied
        if len(calib) < calibration and a.get("language") != "ms" and (a["category"], a["arm"]) not in seen:
            calib.append(a)
            seen.add((a["category"], a["arm"]))
    for a in pool:
        if len(calib) < calibration and a.get("language") != "ms" and a not in calib:
            calib.append(a)

    out: dict[str, list[str]] = {r["id"]: [a["answer_id"] for a in calib] for r in raters}
    load = Counter({r["id"]: 0 for r in raters})
    calib_ids = {a["answer_id"] for a in calib}
    for a in pool:
        if a["answer_id"] in calib_ids:
            continue
        eligible = [r["id"] for r in raters if a.get("language") != "ms" or r.get("reads_malay")]
        rng.shuffle(eligible)  # ties broken at random, not by rater order
        for rid in sorted(eligible, key=lambda r: load[r])[:per_answer]:
            out[rid].append(a["answer_id"])
            load[rid] += 1
    return {rid: sorted(ids) for rid, ids in out.items()}


# ── agreement ────────────────────────────────────────────────────────────────


def _ordinal(values: list[int]) -> Callable[[int, int], float]:
    """Krippendorff's ordinal metric, from the pooled frequencies of each value."""
    n = Counter(values)
    order = sorted(n)

    def d(c: int, k: int) -> float:
        lo, hi = sorted((c, k))
        between = sum(n[g] for g in order if lo <= g <= hi)
        return (between - (n[lo] + n[hi]) / 2) ** 2
    return d


def krippendorff_alpha(units: Iterable[Iterable[float | None]], metric: str = "ordinal") -> float | None:
    """Alpha over units (one list of ratings per answer, None = not rated).

    Units with fewer than two ratings carry no agreement information and drop
    out, as Krippendorff specifies. Metrics: nominal, interval, ordinal.
    """
    kept = [[v for v in u if v is not None] for u in units]
    kept = [u for u in kept if len(u) >= 2]
    values = [v for u in kept for v in u]
    if len(set(values)) < 2:
        return None if not values else 1.0
    if metric == "nominal":
        def dist(c: float, k: float) -> float: return float(c != k)
    elif metric == "interval":
        def dist(c: float, k: float) -> float: return (c - k) ** 2
    else:
        dist = _ordinal([int(v) for v in values])  # type: ignore[assignment]
    total = len(values)
    observed = sum(
        sum(dist(u[i], u[j]) for i in range(len(u)) for j in range(len(u)) if i != j) / (len(u) - 1)
        for u in kept
    ) / total
    expected = sum(dist(c, k) for c in values for k in values) / (total * (total - 1))
    return None if expected == 0 else 1 - observed / expected


def _ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1  # ties share the average rank
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 3:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    sy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return None if not sx or not sy else cov / (sx * sy)


def weighted_kappa(a: list[int], b: list[int], categories: tuple[int, ...] = SCALE) -> float | None:
    """Cohen's kappa with quadratic weights, for two raters on the 1-5 scale."""
    if len(a) != len(b) or not a:
        return None
    idx = {c: i for i, c in enumerate(categories)}
    k, n = len(categories), len(a)
    obs = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b):
        obs[idx[x]][idx[y]] += 1
    rows = [sum(r) for r in obs]
    cols = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = [[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)]
    num = sum(w[i][j] * obs[i][j] for i in range(k) for j in range(k))
    den = sum(w[i][j] * rows[i] * cols[j] / n for i in range(k) for j in range(k))
    return None if den == 0 else 1 - num / den


# ── merging judge, humans and the lexical score ──────────────────────────────


def overall(scores: dict[str, Any] | None) -> float | None:
    vals = [scores[c] for c in CRITERIA if scores and isinstance(scores.get(c), (int, float))]
    return sum(vals) / len(vals) if len(vals) == len(CRITERIA) else None


def human_summary(ratings: list[dict[str, Any]]) -> dict[str, Any]:
    """Per answer id: mean of each criterion, acceptable share, comments. 'Unsure' is counted apart."""
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in ratings:
        by[r["answer_id"]].append(r)
    out = {}
    for aid, rows in by.items():
        sure = [r for r in rows if r.get("acceptable") in ("Yes", "No")]
        means = {}
        for c in CRITERIA:
            vals = [r[c] for r in rows if isinstance(r.get(c), (int, float))]
            means[c] = sum(vals) / len(vals) if vals else None
        out[aid] = {
            "n": len(rows), "means": means, "overall": overall(means),
            "acceptable_share": (sum(r["acceptable"] == "Yes" for r in sure) / len(sure)) if sure else None,
            "unsure": sum(r.get("acceptable") == "Unsure" for r in rows),
            "comments": " | ".join(f"{r['rater_id']}: {r['comment']}" for r in rows if r.get("comment")),
            "acceptable_split": len({r["acceptable"] for r in sure}) > 1,
        }
    return out


def review_reasons(judge: dict[str, Any] | None, human: dict[str, Any] | None, lexical_correct: bool | None) -> list[str]:
    """Why an answer needs a person's final label; empty when nothing disagrees."""
    reasons = []
    if judge and human:
        gaps = [abs(judge[c] - human["means"][c]) for c in CRITERIA
                if isinstance(judge.get(c), (int, float)) and human["means"].get(c) is not None]
        if gaps and max(gaps) >= REVIEW_GAP:
            reasons.append(f"judge vs humans differ by {max(gaps):.1f}")
    if judge and lexical_correct is not None and isinstance(judge.get("acceptable"), bool) \
            and judge["acceptable"] != lexical_correct:
        reasons.append("judge and lexical scoring disagree")
    if human and human.get("acceptable_split"):
        reasons.append("raters disagree on acceptable")
    return reasons


def agreement(answer_ids: list[str], judge: dict[str, dict[str, Any]], ratings: list[dict[str, Any]],
              lexical: dict[str, bool | None], repeats: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Every number in the Agreement tab."""
    out: dict[str, Any] = {"inter_rater": {}, "judge_vs_human": {}, "judge_self": {}, "judge_vs_lexical": None}
    by: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for r in ratings:
        by[r["answer_id"]][r["rater_id"]] = r
    raters = sorted({r["rater_id"] for r in ratings})
    humans = human_summary(ratings)
    for c in CRITERIA:
        units = [[by[a].get(rid, {}).get(c) for rid in raters] for a in answer_ids]
        out["inter_rater"][c] = krippendorff_alpha(units, "ordinal")
        pairs = [(judge[a][c], humans[a]["means"][c]) for a in answer_ids
                 if a in judge and isinstance(judge[a].get(c), int) and a in humans and humans[a]["means"][c] is not None]
        out["judge_vs_human"][c] = {
            "n": len(pairs),
            "spearman": spearman([p[0] for p in pairs], [p[1] for p in pairs]),
            "weighted_kappa": weighted_kappa([p[0] for p in pairs], [min(5, max(1, round(p[1]))) for p in pairs]),
        }
        twice = [(judge[a][c], repeats[a][c]) for a in repeats if a in judge
                 and isinstance(judge[a].get(c), int) and isinstance(repeats[a].get(c), int)]
        out["judge_self"][c] = {
            "n": len(twice),
            "exact": (sum(x == y for x, y in twice) / len(twice)) if twice else None,
            "weighted_kappa": weighted_kappa([x for x, _ in twice], [y for _, y in twice]),
        }
    units = [[{"Yes": 1, "No": 0}.get(by[a].get(rid, {}).get("acceptable")) for rid in raters] for a in answer_ids]
    out["inter_rater"]["acceptable"] = krippendorff_alpha(units, "nominal")
    cells = Counter()
    for a in answer_ids:
        j, lx = (judge.get(a) or {}).get("acceptable"), lexical.get(a)
        if isinstance(j, bool) and lx is not None:
            cells[(j, bool(lx))] += 1
    out["judge_vs_lexical"] = {"both_yes": cells[(True, True)], "judge_only": cells[(True, False)],
                               "lexical_only": cells[(False, True)], "both_no": cells[(False, False)]}
    return out
