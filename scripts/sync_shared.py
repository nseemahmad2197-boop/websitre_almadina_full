#!/usr/bin/env python3
"""Generate native pricing tables. --check is read-only and fails on drift.

Outputs stay inside each app so Xcode, Gradle and Render need no cross-root
runtime imports. Existing method signatures and non-pricing code are retained.
"""
import argparse
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MEMBERSHIPS = ("standard", "premium", "diamond")
ZONES = ("westBank", "jerusalem", "interior")
KOTLIN_ZONES = ("WEST_BANK", "JERUSALEM", "INTERIOR")
TARGETS = {
    "web": "apps/web/app/lib/data.ts",
    "android": "apps/android/app/src/main/java/com/almadinaexpress/app/data/Models.kt",
    "ios": "apps/ios/Sources/AlmadinaCore/BusinessRules.swift",
}
BEGIN = "// BEGIN SHARED PRICING"
END = "// END SHARED PRICING"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(label + " must contain exactly: " + ", ".join(expected))


def load_pricing(root=ROOT):
    data = json.loads((root / "shared/pricing.json").read_text(encoding="utf-8"),
                      object_pairs_hook=unique_object, parse_constant=invalid_constant)
    keys(data, ("schemaVersion", "currency", "deliveryPricing", "returnPricing"), "pricing")
    if type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1 or data["currency"] != "ILS":
        raise ValueError("Only pricing schemaVersion 1 / ILS is supported.")
    for table in ("deliveryPricing", "returnPricing"):
        keys(data[table], MEMBERSHIPS, table)
        for membership in MEMBERSHIPS:
            keys(data[table][membership], ZONES, table + "." + membership)
            for zone in ZONES:
                amount = data[table][membership][zone]
                if type(amount) not in (int, float) or not 0 <= amount <= 1_000_000 or not math.isfinite(amount):
                    raise ValueError("Prices must be finite, non-negative numbers up to 1,000,000.")
                if Decimal(str(amount)) * 100 != (Decimal(str(amount)) * 100).to_integral_value():
                    raise ValueError("Prices must have at most two decimal places.")
    return data


def number(amount, kotlin=False):
    result = format(Decimal(str(amount)).normalize(), "f")
    return result + ".0" if kotlin and "." not in result else result


def render_web(data):
    tables = []
    for name in ("deliveryPricing", "returnPricing"):
        lines = ["export const " + name + " = {"]
        for member in MEMBERSHIPS:
            values = ", ".join(f"{zone}: {number(data[name][member][zone])}" for zone in ZONES)
            lines.append(f"  {member}: {{ {values} }},")
        tables.append("\n".join(lines + ["} as const;"]))
    return "\n\n".join(tables)


def render_android(data):
    functions = []
    for name, table in (("baseDeliveryFee", "deliveryPricing"), ("returnDeliveryFee", "returnPricing")):
        lines = [f"fun {name}(membership: Membership, zone: DeliveryZone): Double = when (membership) {{"]
        for member in MEMBERSHIPS:
            lines.append(f"    Membership.{member.upper()} -> when (zone) {{")
            for zone, native in zip(ZONES, KOTLIN_ZONES):
                lines.append(f"        DeliveryZone.{native} -> {number(data[table][member][zone], kotlin=True)}")
            lines.append("    }")
        functions.append("\n".join(lines + ["}"]))
    return "\n\n".join(functions)


def render_ios(data):
    functions = []
    for name, table in (("baseFee", "deliveryPricing"), ("returnFee", "returnPricing")):
        members = []
        for member in MEMBERSHIPS:
            values = ",".join(number(data[table][member][zone]) for zone in ZONES)
            members.append(f".{member}: [{values}]")
        functions.append(
            f"    public static func {name}(_ membership: Membership, _ zone: Zone) -> Double {{\n"
            "        let amounts: [Membership: [Double]] = [" + ", ".join(members) + "]\n"
            "        return amounts[membership]![zone == .westBank ? 0 : zone == .jerusalem ? 1 : 2]\n"
            "    }")
    return "\n".join(functions)


def replace_block(text, body, digest, indent=""):
    start = indent + BEGIN
    end = indent + END
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        raise ValueError("Expected one generated pricing block; no files were written.")
    pattern = re.compile(r"^" + re.escape(start) + r"\n.*?^" + re.escape(end) + r"$", re.M | re.S)
    replacement = (start + "\n" + indent + "// Generated from shared/pricing.json; run python3 scripts/sync_shared.py.\n"
                   + indent + "// Source SHA256: " + digest + "\n" + body + "\n" + end)
    result, count = pattern.subn(lambda _: replacement, text)
    if count != 1:
        raise ValueError("Invalid generated pricing markers; no files were written.")
    return result


def update_region_defaults(text, prices):
    # These pre-existing catalog fields mirror standard delivery prices. Only
    # fee literals are generated; locality names, ordering and cities stay intact.
    pattern = re.compile(r"(const curatedGovernorates = \[\n)(.*?)(\n\];)", re.S)
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise ValueError("Missing web governorate catalog; no files were written.")
    seen = set()

    def fee(match):
        name = match.group(2)
        if name in seen:
            raise ValueError("Duplicate governorate name.")
        seen.add(name)
        zone = "jerusalem" if name == "القدس" else "interior" if name == "الداخل" else "westBank"
        return match.group(1) + number(prices[zone]) + match.group(4)

    original = matches[0]
    body = re.sub(r'(name: "([^"]+)", fee: )([0-9]+(?:\.[0-9]+)?)(, cities:)', fee, original.group(2))
    if len(seen) < 12 or not {"القدس", "الداخل"}.issubset(seen):
        raise ValueError("Unexpected web governorate catalog; no files were written.")
    return text[:original.start(2)] + body + text[original.end(2):]


def generated_outputs(root=ROOT):
    data = load_pricing(root)
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    outputs = {}
    renderers = {"web": render_web, "android": render_android, "ios": render_ios}
    for app, relative in TARGETS.items():
        path = root / relative
        if not path.is_file() or path.resolve() != path.absolute():
            raise ValueError("Missing or symlinked source: " + relative)
        text = replace_block(path.read_text(encoding="utf-8"), renderers[app](data), digest, "    " if app == "ios" else "")
        if app == "web":
            text = update_region_defaults(text, data["deliveryPricing"]["standard"])
        outputs[relative] = text
    return outputs


def synchronize(root=ROOT, check=False):
    # Validate EVERY input and marker before the first write. --check never repairs
    # files silently: CI must catch omitted or manually edited generated outputs.
    outputs = generated_outputs(root)
    changed = [relative for relative, text in outputs.items()
               if (root / relative).read_bytes() != text.encode("utf-8")]
    if not check:
        for relative in changed:
            (root / relative).write_bytes(outputs[relative].encode("utf-8"))
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        changed = synchronize(check=args.check)
    except (OSError, ValueError) as error:
        print("Shared pricing error: " + str(error), file=sys.stderr)
        return 1
    if changed:
        print(("Out of sync: " if args.check else "Generated: ") + ", ".join(changed))
        if args.check:
            print("Run python3 scripts/sync_shared.py and commit all generated outputs.")
            return 1
    else:
        print("Shared pricing: all three platforms are in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
