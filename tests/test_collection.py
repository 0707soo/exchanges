import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_rates as fetcher
import run_collection as runner
import requests


def html_fixture(date="2020년01월01일", extra=""):
    rows = ""
    for label in ("미국 USD", "일본 JPY (100)", "유로 EUR", "중국 CNY"):
        rows += "<tr><td>" + label + "</td>" + "<td>1,234.50</td>" * 10 + "</tr>"
    return (
        f"기준일</em>:<strong>{date}</strong>"
        f"고시일시</em>:<strong>{date}</strong><strong>12시00분00초</strong>"
        f"(1회차)<table class='tblBasic'>{rows}{extra}</table>"
    )


def snapshot():
    return {
        "published_at_kst": "2020-01-01T12:00:00+09:00",
        "captured_at_utc": "2020-01-01T03:01:00+00:00",
        "published_text": "2020년01월01일 12시00분00초",
        "basis_date_text": "2020년01월01일", "sequence": 1,
        "rates": dict.fromkeys(("USD", "JPY", "EUR", "CNY"), 100.0),
    }


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.history = self.data / "history"
        self.history.mkdir(parents=True)
        self.patches = [
            patch.object(fetcher, "DATA_DIR", self.data),
            patch.object(fetcher, "HISTORY_DIR", self.history),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def test_parser_keeps_units_and_rates(self):
        rows = fetcher.extract_rows(html_fixture())
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[1].unit_label, "100")
        self.assertEqual(rows[0].base_rate, 1234.5)

    def test_invalid_numbers(self):
        for value in ("NaN", "inf", "-1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                fetcher._to_float(value)

    def test_validation_rejects_missing_metadata_and_bad_rates(self):
        for key, value in (("sequence", None), ("published_at_kst", None), ("basis_date_text", None)):
            s = snapshot()
            s[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                fetcher.validate_snapshot(s)
        for value in (0, float("nan"), -1):
            s = snapshot()
            s["rates"]["USD"] = value
            with self.assertRaises(ValueError):
                fetcher.validate_snapshot(s)

    def test_regression_and_future_dates_are_rejected(self):
        s = snapshot()
        older = copy.deepcopy(s)
        older["published_at_kst"] = "2019-01-01T12:00:00+09:00"
        with self.assertRaises(ValueError):
            fetcher.validate_snapshot(older, s)
        s["published_at_kst"] = "2021-01-01T12:00:00+09:00"
        with self.assertRaises(ValueError):
            fetcher.validate_snapshot(s)

    def test_rejected_collection_preserves_last_good_files(self):
        previous = snapshot()
        previous["published_at_kst"] = "2021-01-01T12:00:00+09:00"
        fetcher.atomic_json(self.data / "latest.json", previous)
        before = (self.data / "latest.json").read_bytes()
        with patch.object(fetcher, "fetch_html", return_value=html_fixture()), self.assertRaises(ValueError):
            fetcher.main()
        self.assertEqual((self.data / "latest.json").read_bytes(), before)
        self.assertEqual(list(self.history.iterdir()), [])

    def test_duplicate_currency_is_rejected(self):
        row = "<tr><td>미국 USD</td>" + "<td>1</td>" * 10 + "</tr>"
        with patch.object(fetcher, "fetch_html", return_value=html_fixture(extra=row)), self.assertRaises(ValueError):
            fetcher.main()
        self.assertFalse((self.data / "latest.json").exists())

    def test_atomic_write_does_not_destroy_good_file_on_serialization_error(self):
        path = self.data / "latest.json"
        fetcher.atomic_json(path, {"good": True})
        with self.assertRaises(ValueError):
            fetcher.atomic_json(path, {"bad": float("nan")})
        self.assertEqual(json.loads(path.read_text()), {"good": True})
        self.assertEqual({p.name for p in self.data.iterdir()}, {"history", "latest.json"})

    def test_history_is_idempotent_and_reverse_reader_handles_large_utf8_lines(self):
        s = snapshot()
        s["description"] = "환율" * 30000
        self.assertTrue(fetcher.append_snapshot(s))
        self.assertFalse(fetcher.append_snapshot(s))
        path = next(self.history.glob("*.ndjson"))
        self.assertEqual(fetcher.load_last_snapshot(path), s)
        self.assertEqual(len(list(fetcher.reverse_lines(path))), 1)

    def test_chart_rebuild_bounds_tail_and_orders_across_months(self):
        for month, start, count in (("2019-12", 0, 20), ("2020-01", 20, 3010)):
            with (self.history / f"{month}.ndjson").open("w") as f:
                for value in range(start, start + count):
                    s = snapshot()
                    s["rates"]["USD"] = value
                    f.write(json.dumps(s) + "\n")
        fetcher.rebuild_series()
        data = json.loads((self.data / "series.json").read_text())["series"]["USD"]
        self.assertEqual(len(data), 3000)
        self.assertEqual((data[0]["v"], data[-1]["v"]), (30, 3029))
        recent = json.loads((self.data / "recent.json").read_text())["snapshots"]
        self.assertEqual(len(recent), 100)
        self.assertEqual(recent[-1]["rows"]["USD"]["base_rate"], 3029)

    def test_retry_transient_failure_closes_sessions(self):
        session = MagicMock()
        response = MagicMock(text="<table class='tblBasic'>")
        session.__enter__.return_value = session
        session.get.side_effect = [requests.ConnectionError("temporary"), MagicMock()]
        session.post.return_value = response
        with patch.object(fetcher.requests, "Session", return_value=session), patch.object(fetcher.time, "sleep") as sleep:
            self.assertIn("tblBasic", fetcher.fetch_html(fetcher.datetime.now(fetcher.KST)))
        self.assertEqual(session.__exit__.call_count, 2)
        sleep.assert_called_once_with(2)

    def test_permanent_http_error_is_not_retried(self):
        session = MagicMock()
        session.__enter__.return_value = session
        response = requests.Response()
        response.status_code = 403
        session.get.return_value.raise_for_status.side_effect = requests.HTTPError(response=response)
        with patch.object(fetcher.requests, "Session", return_value=session), patch.object(fetcher.time, "sleep") as sleep:
            with self.assertRaises(requests.HTTPError):
                fetcher.fetch_html(fetcher.datetime.now(fetcher.KST))
        sleep.assert_not_called()

    def test_timeout_records_failure_and_preserves_last_success(self):
        fetcher.atomic_json(self.data / "latest.json", snapshot())
        fetcher.atomic_json(self.data / "status.json", {
            "last_success_at_utc": "2020-01-01T03:01:00Z", "failure_streak": 2, "total_failures": 5,
        })
        with patch.object(runner.subprocess, "run", side_effect=runner.subprocess.TimeoutExpired("fetch", 300)):
            status = runner.collect(self.root)
        self.assertFalse(status["last_attempt_success"])
        self.assertEqual(status["last_success_at_utc"], "2020-01-01T03:01:00Z")
        self.assertEqual(status["failure_streak"], 3)
        self.assertEqual(status["total_failures"], 6)
        self.assertEqual(json.loads((self.data / "latest.json").read_text()), snapshot())


if __name__ == "__main__":
    unittest.main()
