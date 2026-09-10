"""Exercise CI control flow with stand-ins; these are NOT native iOS tests."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MacVerificationScriptTests(unittest.TestCase):
    def run_fixture(self, statuses):
        temporary = tempfile.TemporaryDirectory(prefix="almadina-mac-control-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "scripts").mkdir()
        tools = root / "tools"
        tools.mkdir()
        shutil.copy2(ROOT / "apps/ios/scripts/verify-mac.sh", root / "scripts/verify-mac.sh")
        (root / "scripts/verify_source.py").write_text("print('fixture static check')\n")
        scripts = {
            "uname": "#!/bin/bash\necho Darwin\n",
            "swift": "#!/bin/bash\necho fixture-unit-tests\n",
            "xcodebuild": """#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
if args == ['-version']:
    print('Xcode 26.0')
    raise SystemExit(0)
with open(os.environ['FIXTURE_CALLS'], 'a') as stream:
    stream.write(json.dumps(args) + '\\n')
if args[-1] != 'test':
    print('fixture-build')
    raise SystemExit(0)
destination = args[args.index('-destination') + 1]
simulator = destination.split('id=')[1]
bundle = pathlib.Path(args[args.index('-resultBundlePath') + 1])
bundle.mkdir()
(bundle / 'fixture.txt').write_text(simulator)
status = int(os.environ['FIXTURE_' + simulator])
if status:
    print('UITests.swift:123: error: fixture test : XCTAssertTrue failed - missing control', file=sys.stderr)
else:
    print('fixture-ui-test-passed')
raise SystemExit(status)
""",
        }
        for name, content in scripts.items():
            path = tools / name
            path.write_text(content)
            path.chmod(0o755)
        env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"],
                   SIMULATOR_ID="PHONE\nTABLET", FIXTURE_CALLS=str(root / "calls.jsonl"),
                   FIXTURE_PHONE=str(statuses[0]), FIXTURE_TABLET=str(statuses[1]))
        run = subprocess.run(["bash", str(root / "scripts/verify-mac.sh")], env=env,
                             cwd=root, text=True, capture_output=True)
        return root, run

    def test_both_selected_devices_run_and_get_distinct_result_bundles(self):
        root, run = self.run_fixture((0, 0))
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        bundles = list(root.glob("build/ci-reports/verify-*/*.xcresult"))
        self.assertEqual({path.stem for path in bundles}, {"PHONE", "TABLET"})

    def test_first_device_failure_does_not_skip_second_or_turn_gate_green(self):
        root, run = self.run_fixture((65, 0))
        self.assertEqual(run.returncode, 65, run.stdout + run.stderr)
        self.assertIn("PASS: Simulator TABLET", run.stdout)
        self.assertIn("Failure details", run.stdout)
        report = next(root.glob("build/ci-reports/verify-*/failure-details.txt"))
        self.assertIn("XCTAssertTrue failed - missing control", report.read_text())
        self.assertEqual(len(list(root.glob("build/ci-reports/verify-*/*.log"))), 2)

    def test_second_device_failure_still_blocks_success(self):
        _, run = self.run_fixture((0, 65))
        self.assertEqual(run.returncode, 65, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
