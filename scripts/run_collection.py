"""Record a bounded collection attempt, including failure status for the workflow."""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from fetch_rates import atomic_json

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def collect(root=ROOT):
    started = datetime.now(timezone.utc).isoformat()
    previous = read_json(root / "data/status.json")
    before = read_json(root / "data/latest.json")
    try:
        proc = subprocess.run(
            [sys.executable, str(root / "scripts/fetch_rates.py")],
            capture_output=True, text=True, timeout=300, cwd=root,
        )
        exit_code = proc.returncode
        log = "\n".join(part.strip() for part in (proc.stdout, proc.stderr) if part)
    except subprocess.TimeoutExpired:
        exit_code, log = 124, "Collection exceeded the 300 second deadline"
    success = exit_code == 0
    latest = read_json(root / "data/latest.json")
    ended = datetime.now(timezone.utc).isoformat()
    entry = {
        "attempted_at_utc": started,
        "exit_code": exit_code,
        "changed": success and (
            before.get("published_at_kst"), before.get("sequence")
        ) != (latest.get("published_at_kst"), latest.get("sequence")),
        "sequence_before": before.get("sequence"),
        "sequence_after": latest.get("sequence"),
        "log_excerpt": log.splitlines()[-5:],
    }
    status = {
        "source": "hanabank",
        "poll_mode": "scheduled-five-minute-with-manual-dispatch",
        "trigger_reason": os.environ.get("TRIGGER_REASON", "manual"),
        "window_started_at_utc": started,
        "window_ended_at_utc": ended,
        "attempt_count": 1,
        "last_attempt_at_utc": started,
        "last_attempt_success": success,
        "last_success_at_utc": ended if success else (
            previous.get("last_success_at_utc") or previous.get("latest_captured_at_utc")
        ),
        "last_error": None if success else (log.splitlines()[-1] if log else f"exit code {exit_code}"),
        "last_log_excerpt": entry["log_excerpt"],
        "attempt_logs": [entry],
        "latest_published_at_kst": latest.get("published_at_kst"),
        "latest_captured_at_utc": latest.get("captured_at_utc"),
        "latest_sequence": latest.get("sequence"),
        "failure_streak": 0 if success else int(previous.get("failure_streak", 0)) + 1,
        "total_failures": int(previous.get("total_failures", 0)) + int(not success),
        "next_delay_seconds": 300,
        "chain_driver": "github-actions-schedule",
    }
    atomic_json(root / "fetch.log", [entry])
    atomic_json(root / "data/status.json", status)
    return status


if __name__ == "__main__":
    status = collect()
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            output.write(f"had_success={str(status['last_attempt_success']).lower()}\n")
    # Report upstream errors in the following workflow step, after committing status.
    print(json.dumps(status, ensure_ascii=False))
