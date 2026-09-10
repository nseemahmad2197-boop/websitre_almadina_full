#!/usr/bin/env python3
"""Check every affected platform and report all failures, without bypassing CI."""
import json
import os
from pathlib import Path

PLATFORMS = ("web", "android", "ios")
LABELS = {"shared": "Shared source and affected apps", "web": "Web build and tests",
          "android": "Android build and tests", "ios": "iOS build and tests"}
RESULTS = {"success", "failure", "cancelled", "skipped"}


def evaluate(jobs):
    if not isinstance(jobs, dict):
        return [], ["Invalid job results: expected an object."]
    rows, errors = [], []

    def result(name):
        job = jobs.get(name)
        if not isinstance(job, dict):
            return "missing"
        value = job.get("result")
        return value if isinstance(value, str) and value in RESULTS else "invalid"

    shared = result("shared")
    rows.append((LABELS["shared"], "yes", shared))
    if shared != "success":
        errors.append(f"{LABELS['shared']}: {shared}. Open that job's log.")
    shared_job = jobs.get("shared")
    outputs = shared_job.get("outputs", {}) if isinstance(shared_job, dict) else {}
    if not isinstance(outputs, dict):
        outputs = {}
    for platform in PLATFORMS:
        affected = outputs.get(platform)
        state = result(platform)
        required = "yes" if affected == "true" else "no" if affected == "false" else "unknown"
        rows.append((LABELS[platform], required, state))
        if affected not in ("true", "false"):
            errors.append(f"{LABELS[platform]}: affected status is missing or invalid; cannot verify this platform.")
        elif affected == "true" and state != "success":
            errors.append(f"{LABELS[platform]}: {state}. This affected platform must pass; open its job log.")
        elif affected == "false" and state not in ("success", "skipped"):
            errors.append(f"{LABELS[platform]}: unexpected {state}, even though this platform is unaffected.")
    return rows, errors


def main():
    try:
        jobs = json.loads(os.environ.get("JOBS", ""))
    except json.JSONDecodeError:
        jobs = None
    rows, errors = evaluate(jobs)
    report = ["## Monorepo verification", "", "| Check | Affected | Result |",
              "| --- | --- | --- |"]
    report.extend(f"| {label} | {affected} | {state} |" for label, affected, state in rows)
    report.extend(["", "Fix the failed jobs listed above, then push the correction to run the checks again."
                   if errors else "All affected platforms passed."])
    text = "\n".join(report) + "\n"
    print(text)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as handle:
            handle.write(text)
    for message in errors:
        print("::error::" + message)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
