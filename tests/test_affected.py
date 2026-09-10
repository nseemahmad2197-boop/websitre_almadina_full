import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("affected", ROOT / "scripts/affected.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class AffectedTests(unittest.TestCase):
    def test_app_edits_only_build_that_app(self):
        for app in module.APPS:
            result = module.affected_paths([f"apps/{app}/file with spaces.txt"])
            self.assertEqual(result, {name: name == app for name in module.APPS})

    def test_shared_changes_and_unknown_config_build_every_app(self):
        for file in ("shared/pricing.json", "scripts/sync_shared.py", "tests/test_shared.py",
                     ".github/workflows/verify.yml", "release-manifest.json", "new.config"):
            self.assertTrue(all(module.affected_paths([file]).values()), file)

    def test_docs_skip_app_builds_and_render_only_builds_web(self):
        self.assertFalse(any(module.affected_paths(["README-AR.md", "docs/ARCHITECTURE-AR.md"]).values()))
        self.assertEqual(module.affected_paths(["render.yaml"]), {"web": True, "android": False, "ios": False})

    def test_missing_history_runs_all_instead_of_silently_skipping(self):
        for base in ("", "0" * 40, "--help", "invalid-sha"):
            self.assertIsNone(module.changed_files(base))
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(module.changed_files("a" * 40, cwd=directory))

    def test_git_move_across_apps_builds_both_source_and_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()
            git("init", "-q")
            (root / "apps/web").mkdir(parents=True)
            (root / "apps/android").mkdir(parents=True)
            (root / "apps/web/a.txt").write_text("retained content\n")
            git("add", ".")
            git("commit", "-qm", "before")
            base = git("rev-parse", "HEAD")
            (root / "apps/web/a.txt").rename(root / "apps/android/a.txt")
            git("add", "-A")
            git("commit", "-qm", "move")
            files = module.changed_files(base, cwd=root)
            self.assertEqual(module.affected_paths(files), {"web": True, "android": True, "ios": False})


if __name__ == "__main__":
    unittest.main()
