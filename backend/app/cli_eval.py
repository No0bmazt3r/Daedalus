"""The evaluation harness from a terminal — docs/EVALUATION.md.

    cd backend
    python -m app.cli_eval validate                 # check the query set
    python -m app.cli_eval run --practice           # every arm, not citable
    python -m app.cli_eval run                      # official: refuses unless frozen
    python -m app.cli_eval run --arms vector --ids Q01,Q02 --practice
    python -m app.cli_eval list
    python -m app.cli_eval report eval_20261001_120000
    python -m app.cli_eval run --retrieval-only     # retrieval metrics only, no chat model
    python -m app.cli_eval compare eval_A eval_B     # e.g. the chunking ablation
    python -m app.cli_eval judge  eval_… [--model gpt-oss:120b-cloud]   # AI judge, docs/EVAL_SHEETS.md
    python -m app.cli_eval sheets eval_… [--raters data/eval/raters.yaml] [--no-share]
    python -m app.cli_eval pull   eval_…              # ratings back to ratings.csv

A terminal rather than a button because an official run is long — every
question once per arm, through the real model — and is run once, deliberately.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .db import migrations
from .evaluation import evaluation


def _load_env() -> None:
    """The repo's .env, as daedalus.sh exports it for the server; set variables win."""
    path = Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _judge(args: argparse.Namespace) -> int:
    from .evaluation import judge  # noqa: PLC0415

    model = args.model or os.environ.get("DAEDALUS_JUDGE_MODEL", "")
    try:
        out = judge.run(args.run_id, model, allow_self=args.allow_self,
                        on_progress=lambda n, t, what: print(f"\r[{n}/{t}] {what}".ljust(50), end="", flush=True))
    except (judge.JudgeError, evaluation.EvalError) as exc:
        print(f"\n{exc}")
        return 1
    failed = sorted(a for a, v in out["items"].items() if "judge_failed" in v)
    print(f"\n{len(out['items'])} judged, {len(out['repeats'])} judged twice, {len(failed)} failed"
          f"{' (' + ', '.join(failed[:10]) + ')' if failed else ''}. Re-run to retry the failed ones.")
    return 0


def _sheets(args: argparse.Namespace, pull: bool) -> int:
    from .evaluation import sheets  # noqa: PLC0415
    from .system import google_link  # noqa: PLC0415

    raters = Path(args.raters) if args.raters else sheets.RATERS_DEFAULT
    try:
        if pull:
            out = sheets.pull(args.run_id, raters, on_progress=print)
            print(f"{out['ratings']} ratings saved to data/eval/{args.run_id}/ratings.csv\nMaster: {out['master']}")
        else:
            out = sheets.export(args.run_id, raters, share=not args.no_share, on_progress=print)
            print(f"Master: {out['master']}")
            for rid, link in out["raters"].items():
                print(f"  {rid}: {link}")
    except (google_link.GoogleError, evaluation.EvalError) as exc:
        print(exc)
        return 1
    return 0


def _validate() -> int:
    report = evaluation.query_set_report()
    if not report["valid"]:
        print(report["error"])
        return 1
    print(f"{report['total']} questions · sha {report['sha']}")
    for category, n in report["by_category"].items():
        print(f"  {category:24} {n}")
    for warning in report["warnings"]:
        print(f"  ! {warning}")
    return 0


def _run(args: argparse.Namespace) -> int:
    def show(p: evaluation.Progress) -> None:
        print(f"\r[{p.done}/{p.total}] {p.current or ''}".ljust(60), end="", flush=True)

    try:
        record = evaluation.run(
            arms=args.arms.split(",") if args.arms else None,
            practice=args.practice,
            rerun_reason=args.rerun_reason,
            query_ids=args.ids.split(",") if args.ids else None,
            on_progress=show,
            retrieval_only=args.retrieval_only,
        )
    except evaluation.EvalError as exc:
        print(f"\n{exc}")
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted — the answers so far are saved as an aborted run (`list` shows it).")
        return 130
    print(f"\n\nSaved to {evaluation.RUNS_DIR / record['run_id']}\n")
    print(evaluation.report_markdown(record))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli_eval", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate", help="check the query set")
    run = sub.add_parser("run", help="ask every question once per arm")
    run.add_argument("--arms", help=f"comma-separated, from {','.join(evaluation.ARMS)}")
    run.add_argument("--practice", action="store_true", help="run unfrozen; the report is marked not citable")
    run.add_argument("--ids", help="comma-separated question ids — a partial, never-citable run")
    run.add_argument("--rerun-reason", help="required to repeat an official run; written into the report")
    run.add_argument("--retrieval-only", action="store_true",
                     help="retrieval metrics only, no chat model — minutes, for ablations; always practice")
    sub.add_parser("list", help="saved runs")
    report = sub.add_parser("report", help="print a saved run's report")
    report.add_argument("run_id")
    compare = sub.add_parser("compare", help="saved runs side by side, per arm — e.g. a chunking ablation")
    compare.add_argument("run_ids", nargs="+")
    j = sub.add_parser("judge", help="AI judge over a saved run (offline, after the run)")
    j.add_argument("run_id")
    j.add_argument("--model", help="Ollama tag; default DAEDALUS_JUDGE_MODEL")
    j.add_argument("--allow-self", action="store_true", help="let the model that answered judge itself")
    sh = sub.add_parser("sheets", help="create or refresh the Google Sheets for a run")
    sh.add_argument("run_id")
    sh.add_argument("--raters", help="raters file (default data/eval/raters.yaml)")
    sh.add_argument("--no-share", action="store_true", help="make the sheets but do not share them yet")
    pl = sub.add_parser("pull", help="read the ratings back into ratings.csv")
    pl.add_argument("run_id")
    pl.add_argument("--raters", help="raters file (default data/eval/raters.yaml)")
    args = parser.parse_args(argv)
    _load_env()

    migrations.migrate_all()
    if args.command == "validate":
        return _validate()
    if args.command == "run":
        return _run(args)
    if args.command == "judge":
        return _judge(args)
    if args.command in ("sheets", "pull"):
        return _sheets(args, pull=args.command == "pull")
    if args.command == "list":
        for r in evaluation.list_runs():
            kind = "official" if r["official"] else "practice" if r["practice"] else "partial"
            print(f"{r['run_id']}  {r['status']:9} {kind:9} {','.join(r['arms'] or [])}  {r['questions']} questions")
            if r.get("abort_reason"):
                print(f"    aborted: {r['abort_reason']}")
        return 0
    try:
        if args.command == "compare":
            print(evaluation.compare_markdown([evaluation.get_run(r) for r in args.run_ids]))
            return 0
        print(evaluation.report_markdown(evaluation.get_run(args.run_id)))
    except evaluation.EvalError as exc:
        print(exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
