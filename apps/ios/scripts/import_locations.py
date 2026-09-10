#!/usr/bin/env python3
"""Regenerate bundled delivery locality constants from the matching website source.

Usage: python3 scripts/import_locations.py /path/to/website/app/lib
No network, database, or credentials are used. Existing generated Swift output
is mechanically regenerated from the supplied canonical source.
"""
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(sys.argv[1])
official = (source / "palestine-locations.generated.ts").read_text()
website = (source / "data.ts").read_text()

def constant(name):
    value = re.search(r"export const " + name + r" = (.*?)(?: as const)?;", official, re.S)
    if not value:
        raise SystemExit("Missing canonical constant: " + name)
    return json.loads(value.group(1))

def normalize(value):
    value = re.sub("[أإآ]", "ا", value.strip()).replace("ى", "ي").replace("ة", "ه")
    value = re.sub(r"[\u064B-\u065F\u0670ـ]", "", value)
    value = re.sub(r"[()\[\]{}،,./\\_–—-]", " ", value)
    return re.sub(r"\s+", " ", value)

curated = website.split("const curatedGovernorates = [", 1)[1].split("\n];", 1)[0]
entries = re.findall(r'name: "([^"]+)", fee: (\d+), cities: \[(.*?)\]', curated, re.S)
west = constant("WEST_BANK_LOCALITIES")
interior = constant("INTERIOR_LOCALITIES")
lines = ["// Generated from Website v35 delivery lists; regenerate with scripts/import_locations.py.",
         "// Locality names are reference data, not a new geographical or service-area claim.",
         "import Foundation", "", "public extension DeliveryLocations {", "    static let regions: [DeliveryRegion] = ["]
total = 0
for name, fee, values in entries:
    extras = json.loads("[" + values.strip().rstrip(",") + "]")
    names, seen = [], set()
    for value in (interior if name == "الداخل" else west.get(name, [])) + extras:
        key = normalize(value)
        if key and key not in seen:
            seen.add(key)
            names.append(value)
    total += len(names)
    zone = "jerusalem" if name == "القدس" else "interior" if name == "الداخل" else "westBank"
    lines.append("        DeliveryRegion(name: " + json.dumps(name, ensure_ascii=False) + ", zone: ." + zone + ", cities: [")
    for offset in range(0, len(names), 8):
        lines.append("            " + ", ".join(json.dumps(s, ensure_ascii=False) for s in names[offset:offset+8]) + ",")
    lines.append("        ]),")
lines += ["    ]", "}", ""]
assert len(entries) == 12 and total > 1000, "Canonical list unexpectedly incomplete"
target = root / "Sources/AlmadinaCore/DeliveryLocations.generated.swift"
target.write_text("\n".join(lines))
print(f"Generated {len(entries)} regions / {total} localities: {target.name}")
