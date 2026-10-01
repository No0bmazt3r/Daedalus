"""The evaluation harness from a terminal — docs/EVALUATION.md.

    cd backend
    python -m app.cli_eval validate                 # check the query set
    python -m app.cli_eval run --practice           # every arm, not citable
    python -m app.cli_eval run                      # official: refuses unless frozen
    python -m app.cli_eval run --arms vector --ids Q01,Q02 --practice
    python -m app.cli_eval list
    python -m app.cli_eval report eval_20261001_120000

A terminal rather than a button because an official run is long — every
question once per arm, through the real model — and is run once, deliberately.
"""

from __future__ import annotations

import argparse
import sys

from .db import migrations
from .services import evaluation


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
    sub.add_parser("list", help="saved runs")
    report = sub.add_parser("report", help="print a saved run's report")
    report.add_argument("run_id")
    args = parser.parse_args(argv)

    migrations.migrate_all()
    if args.command == "validate":
        return _validate()
    if args.command == "run":
        return _run(args)
    if args.command == "list":
        for r in evaluation.list_runs():
            kind = "official" if r["official"] else "practice" if r["practice"] else "partial"
            print(f"{r['run_id']}  {r['status']:9} {kind:9} {','.join(r['arms'] or [])}  {r['questions']} questions")
            if r.get("abort_reason"):
                print(f"    aborted: {r['abort_reason']}")
        return 0
    try:
        print(evaluation.report_markdown(evaluation.get_run(args.run_id)))
    except evaluation.EvalError as exc:
        print(exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
