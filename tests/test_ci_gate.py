import importlib.util
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/verify_ci.py"
SPEC = importlib.util.spec_from_file_location("verify_ci", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def jobs(affected=(True, True, True)):
    value = {"shared": {"result": "success", "outputs": {}}}
    for name, required in zip(module.PLATFORMS, affected):
        value["shared"]["outputs"][name] = str(required).lower()
        value[name] = {"result": "success" if required else "skipped"}
    return value


class CIGateTests(unittest.TestCase):
    def test_each_valid_affected_combination_passes(self):
        for affected in itertools.product((False, True), repeat=3):
            self.assertFalse(module.evaluate(jobs(affected))[1])

    def test_each_failed_cancelled_or_skipped_required_job_blocks_merge(self):
        for name, result in itertools.product(module.PLATFORMS, ("failure", "cancelled", "skipped")):
            value = jobs()
            value[name]["result"] = result
            self.assertTrue(module.evaluate(value)[1], (name, result))

    def test_both_android_and_ios_failures_are_reported(self):
        value = jobs()
        value["android"]["result"] = "failure"
        value["ios"]["result"] = "failure"
        rows, errors = module.evaluate(value)
        self.assertEqual(len(rows), 4)
        self.assertEqual(len(errors), 2)
        self.assertIn("Android build and tests", errors[0])
        self.assertIn("iOS build and tests", errors[1])

    def test_missing_or_invalid_metadata_cannot_silently_skip_validation(self):
        for data in (None, [], {}, {"shared": {"result": "success"}}):
            self.assertTrue(module.evaluate(data)[1])
        for flag in (None, "", "TRUE", True, [], {}):
            value = jobs()
            value["shared"]["outputs"]["ios"] = flag
            self.assertTrue(module.evaluate(value)[1])
        for result in (None, "", "unknown", [], {}):
            value = jobs()
            value["ios"]["result"] = result
            self.assertTrue(module.evaluate(value)[1])

    def test_shared_failure_blocks_even_when_all_app_jobs_pass(self):
        value = jobs()
        value["shared"]["result"] = "failure"
        self.assertTrue(module.evaluate(value)[1])

    def test_unaffected_job_can_pass_or_skip_but_cannot_fail(self):
        for state, expected_failure in (("success", False), ("skipped", False), ("failure", True), ("cancelled", True)):
            value = jobs((False, False, False))
            value["ios"]["result"] = state
            self.assertEqual(bool(module.evaluate(value)[1]), expected_failure)

    def test_command_writes_summary_and_keeps_failure_with_python_optimization(self):
        value = jobs()
        value["android"]["result"] = "failure"
        value["ios"]["result"] = "failure"
        with tempfile.TemporaryDirectory() as temporary:
            summary = Path(temporary) / "summary.md"
            env = dict(os.environ, JOBS=json.dumps(value), GITHUB_STEP_SUMMARY=str(summary))
            run = subprocess.run([sys.executable, "-O", str(SCRIPT)], env=env, text=True, capture_output=True)
            self.assertEqual(run.returncode, 1)
            self.assertEqual(run.stdout.count("::error::"), 2)
            self.assertIn("| Android build and tests | yes | failure |", summary.read_text())
            self.assertIn("| iOS build and tests | yes | failure |", summary.read_text())

    def test_command_passes_success_and_rejects_malformed_json(self):
        for raw, expected in ((json.dumps(jobs()), 0), ("{broken", 1)):
            env = dict(os.environ, JOBS=raw)
            env.pop("GITHUB_STEP_SUMMARY", None)
            run = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True)
            self.assertEqual(run.returncode, expected)


if __name__ == "__main__":
    unittest.main()
