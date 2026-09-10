import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("sync_shared", ROOT / "scripts/sync_shared.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class SharedPricingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for relative in ["shared/pricing.json", *sync.TARGETS.values()]:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / relative).read_bytes())

    def source_bytes(self):
        return {rel: (self.root / rel).read_bytes() for rel in sync.TARGETS.values()}

    def write_data(self, data):
        (self.root / "shared/pricing.json").write_text(json.dumps(data), encoding="utf-8")

    def test_checked_in_outputs_are_current_and_generation_is_idempotent(self):
        self.assertEqual(sync.synchronize(ROOT, check=True), [])
        before = self.source_bytes()
        self.assertEqual(sync.synchronize(self.root), [])
        self.assertEqual(self.source_bytes(), before)

    def test_one_edit_updates_all_platforms_and_standard_region_defaults(self):
        data = sync.load_pricing(self.root)
        data["deliveryPricing"]["standard"]["jerusalem"] = 37.25
        data["returnPricing"]["diamond"]["interior"] = 26.5
        self.write_data(data)
        before = self.source_bytes()
        self.assertEqual(len(sync.synchronize(self.root, check=True)), 3)
        self.assertEqual(self.source_bytes(), before, "Checking drift must not rewrite files")
        self.assertEqual(len(sync.synchronize(self.root)), 3)
        for contents in self.source_bytes().values():
            self.assertIn(b"37.25", contents)
            self.assertIn(b"26.5", contents)
        web = (self.root / sync.TARGETS["web"]).read_text(encoding="utf-8")
        self.assertIn('name: "القدس", fee: 37.25, cities:', web)
        self.assertEqual(sync.synchronize(self.root, check=True), [])

    def test_manual_edit_in_any_native_output_is_detected(self):
        for app in ("android", "ios"):
            relative = sync.TARGETS[app]
            original = (self.root / relative).read_text(encoding="utf-8")
            old, new = (("DeliveryZone.JERUSALEM -> 35.0", "DeliveryZone.JERUSALEM -> 99.0") if app == "android"
                        else (".standard: [25,35,80]", ".standard: [25,99,80]"))
            self.assertIn(old, original)
            (self.root / relative).write_text(original.replace(old, new, 1), encoding="utf-8")
            self.assertIn(relative, sync.synchronize(self.root, check=True))
            sync.synchronize(self.root)
            self.assertEqual((self.root / relative).read_text(encoding="utf-8"), original)

    def test_invalid_amounts_do_not_modify_any_output(self):
        data = sync.load_pricing(self.root)
        before = self.source_bytes()
        for invalid in (-1, True, "25", None, 1_000_001, 0.001, float("nan"), float("inf")):
            bad = copy.deepcopy(data)
            bad["deliveryPricing"]["standard"]["westBank"] = invalid
            self.write_data(bad)
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                sync.synchronize(self.root)
            self.assertEqual(self.source_bytes(), before)

    def test_missing_unknown_or_duplicate_keys_are_rejected(self):
        data = sync.load_pricing(self.root)
        bad = copy.deepcopy(data)
        bad["returnPricing"]["premium"].pop("interior")
        self.write_data(bad)
        with self.assertRaises(ValueError):
            sync.synchronize(self.root)
        bad = copy.deepcopy(data)
        bad["deliveryPricing"]["platinum"] = bad["deliveryPricing"]["standard"]
        self.write_data(bad)
        with self.assertRaises(ValueError):
            sync.synchronize(self.root)
        text = json.dumps(data).replace('"currency": "ILS"', '"currency": "ILS", "currency": "USD"')
        (self.root / "shared/pricing.json").write_text(text, encoding="utf-8")
        with self.assertRaises(ValueError):
            sync.synchronize(self.root)

    def test_broken_last_target_prevents_partial_generation(self):
        data = sync.load_pricing(self.root)
        data["deliveryPricing"]["premium"]["westBank"] = 23
        self.write_data(data)
        target = self.root / sync.TARGETS["ios"]
        target.write_text(target.read_text(encoding="utf-8").replace(sync.END, "// removed marker"), encoding="utf-8")
        before = self.source_bytes()
        with self.assertRaises(ValueError):
            sync.synchronize(self.root)
        self.assertEqual(self.source_bytes(), before)

    def test_zero_and_two_decimal_fees_are_supported(self):
        data = sync.load_pricing(self.root)
        data["returnPricing"]["premium"]["westBank"] = 0
        data["deliveryPricing"]["diamond"]["interior"] = 55.01
        self.write_data(data)
        self.assertEqual(len(sync.synchronize(self.root)), 3)
        self.assertEqual(sync.synchronize(self.root, check=True), [])


if __name__ == "__main__":
    unittest.main()
