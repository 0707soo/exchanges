"""Record a bounded collection attempt, including failure status for the workflow."""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from fetch_rates import atomic_json, validate_snapshot

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must be a JSON object")
    return data


def failure_count(value):
    try:
        return max(0, int(value))
    except (ValueError, TypeError):
        return 0


def collect(root=ROOT):
    started = datetime.now(timezone.utc).isoformat()
    warnings = []
    try:
        previous = read_json(root / "data/status.json")
    except ValueError:
        previous = {}
        warnings.append("Invalid previous status file; counters reset")
    before = {}
    latest = {}
    successful_at = None
    try:
        before = read_json(root / "data/latest.json")
        latest = before
        proc = subprocess.run(
            [sys.executable, str(root / "scripts/fetch_rates.py")],
            capture_output=True, text=True, timeout=240, cwd=root,
        )
        exit_code = proc.returncode
        log = "\n".join(part.strip() for part in (proc.stdout, proc.stderr) if part)
        latest = read_json(root / "data/latest.json")
        if exit_code == 0:
            validate_snapshot(latest)
            successful_at = datetime.now(timezone.utc).isoformat()
            try:
                baseline_proc = subprocess.run(
                    [sys.executable, str(root / "scripts/fetch_rates.py"), "--refresh-baselines"],
                    capture_output=True, text=True, timeout=45, cwd=root,
                )
                if baseline_proc.returncode or "최초 고시 미확인" in baseline_proc.stdout:
                    warnings.append((baseline_proc.stderr or baseline_proc.stdout).strip()[-1500:])
            except (subprocess.TimeoutExpired, OSError) as error:
                warnings.append(f"First-publication refresh incomplete: {error}")
    except subprocess.TimeoutExpired:
        exit_code, log = 124, "Collection exceeded the 240 second deadline"
    except (ValueError, OSError) as error:
        exit_code, log = 1, f"Collection could not complete: {error}"
    success = exit_code == 0
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
        "last_success_at_utc": successful_at if success else (
            previous.get("last_success_at_utc") or before.get("captured_at_utc")
        ),
        "warnings": warnings,
        "last_error": None if success else (log.splitlines()[-1] if log else f"exit code {exit_code}"),
        "last_log_excerpt": entry["log_excerpt"],
        "attempt_logs": [entry],
        "latest_published_at_kst": latest.get("published_at_kst"),
        "latest_captured_at_utc": latest.get("captured_at_utc"),
        "latest_sequence": latest.get("sequence"),
        "failure_streak": 0 if success else failure_count(previous.get("failure_streak")) + 1,
        "total_failures": failure_count(previous.get("total_failures")) + int(not success),
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
