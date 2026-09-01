#!/usr/bin/env python3
"""Generate the static Palestine locality catalogue used by the application.

The West Bank and Jerusalem catalogue comes from the Palestinian Central
Bureau of Statistics (PCBS) 2015 locality/service tables.  The interior
catalogue joins the Arabic place-name resource from data.gov.il to its
locality/district resource, then excludes Judea and Samaria and Jerusalem
locality code 3000.  Nothing is fetched by the application at runtime.

Run from the repository root:

    python3 scripts/generate-palestine-locations.py
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPOSITORY_ROOT / "app/lib/palestine-locations.generated.ts"

PCBS_BASE_URL = "https://www.pcbs.gov.ps"
PCBS_SOURCES: tuple[tuple[str, str], ...] = (
    ("جنين", "/Portals/_Rainbow/Documents/LCS%20A%20%20Jeneen%202015.htm"),
    ("القدس", "/Portals/_Rainbow/Documents/LCS%20A%20%20Jerusalem%202015.htm"),
    ("قلقيلية", "/Portals/_Rainbow/Documents/LCS%20A%20%20Qalqilia%202015.htm"),
    ("رام الله والبيرة", "/Portals/_Rainbow/Documents/LCS%20A%20%20Ramallah%202015.htm"),
    ("طوباس", "/Portals/_Rainbow/Documents/LCS%20A%20%20Tubas%202015.htm"),
    ("بيت لحم", "/Portals/_Rainbow/Documents/LCS%20A%20Beithlahim%202015.htm"),
    ("الخليل", "/Portals/_Rainbow/Documents/LCS%20A%20Hebron%20%202015.htm"),
    ("أريحا والأغوار", "/Portals/_Rainbow/Documents/LCS%20A%20Jeric%20%202015.htm"),
    ("نابلس", "/Portals/_Rainbow/Documents/LCS%20A%20Nablus%20%202015.htm"),
    ("سلفيت", "/Portals/_Rainbow/Documents/LCS%20A%20Salfeet%202015.htm"),
    ("طولكرم", "/Portals/_Rainbow/Documents/LCS%20A%20Tulkarem%202015.htm"),
)

PCBS_EXPECTED_COUNTS = {
    "جنين": 80,
    "القدس": 44,
    "قلقيلية": 34,
    "رام الله والبيرة": 75,
    "طوباس": 21,
    "بيت لحم": 45,
    "الخليل": 92,
    "أريحا والأغوار": 14,
    "نابلس": 64,
    "سلفيت": 20,
    "طولكرم": 35,
}

DATA_GOV_ARABIC_URL = (
    "https://data.gov.il/api/3/action/datastore_search?"
    "resource_id=e9701dcb-9f1c-43bb-bd44-eb380ade542f&limit=2000"
)
DATA_GOV_DISTRICT_URL = (
    "https://data.gov.il/api/3/action/datastore_search?"
    "resource_id=d47a54ff-87f0-44b3-b33a-f284c0c38e5a&limit=2000"
)

ARABIC_MARKS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
DEDUP_PUNCTUATION = re.compile(r"[()\[\]{}،,./\\_\u2013\u2014\-\"'`]+")
WHITESPACE = re.compile(r"\s+")


class _TableParser(HTMLParser):
    """Small dependency-free parser for the Excel-generated PCBS tables."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag == "table" and self._table is None:
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(WHITESPACE.sub(" ", " ".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if any(self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None


def _fetch(url: str, *, attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
            "User-Agent": "Almadina-Express-locality-generator/1.0",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except Exception as error:  # pragma: no cover - depends on network state
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Unable to download {url}") from last_error


def _display_name(value: Any) -> str:
    """Normalize presentation text without replacing meaningful Arabic letters."""

    name = unicodedata.normalize("NFKC", str(value or ""))
    name = name.replace("ـ", "").replace("־", "-")
    name = ARABIC_MARKS.sub("", name)
    name = "".join(character for character in name if unicodedata.category(character) != "Cf")
    return WHITESPACE.sub(" ", name).strip()


def _dedupe_key(value: str) -> str:
    value = _display_name(value)
    value = value.translate(str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"}))
    value = DEDUP_PUNCTUATION.sub(" ", value)
    return WHITESPACE.sub(" ", value).strip()


def _dedupe_names(values: list[str]) -> list[str]:
    names: OrderedDict[str, str] = OrderedDict()
    for raw_value in values:
        name = _display_name(raw_value)
        key = _dedupe_key(name)
        if name and key and key not in names:
            names[key] = name
    return list(names.values())


def _canonical_code(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return str(int(float(str(value).strip())))
    except (TypeError, ValueError):
        return None


def _load_pcbs_localities(url: str) -> list[str]:
    html = _fetch(url).decode("windows-1256")
    parser = _TableParser()
    parser.feed(html)
    if not parser.tables:
        raise RuntimeError(f"PCBS source did not contain a table: {url}")

    table = max(parser.tables, key=len)
    header_index = next(
        (index for index, row in enumerate(table) if "رمز التجمع" in row and "اسم التجمع" in row),
        None,
    )
    if header_index is None:
        raise RuntimeError(f"PCBS table headers changed: {url}")

    headers = table[header_index]
    code_index = headers.index("رمز التجمع")
    name_index = headers.index("اسم التجمع")
    values: list[str] = []
    for row in table[header_index + 1 :]:
        if len(row) <= max(code_index, name_index):
            continue
        if _canonical_code(row[code_index]) is None:
            continue
        name = _display_name(row[name_index])
        if name:
            values.append(name)
    return _dedupe_names(values)


def _load_ckan_records(url: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = 0
    while True:
        page_url = url if offset == 0 else f"{url}&offset={offset}"
        payload = json.loads(_fetch(page_url).decode("utf-8"))
        if not payload.get("success"):
            raise RuntimeError(f"CKAN query failed: {page_url}")
        result = payload["result"]
        page = result.get("records", [])
        records.extend(page)
        total = int(result.get("total", len(records)))
        if not page or len(records) >= total:
            break
        offset = len(records)
    return records


def _load_interior_localities() -> tuple[list[str], int]:
    arabic_records = _load_ckan_records(DATA_GOV_ARABIC_URL)
    district_records = _load_ckan_records(DATA_GOV_DISTRICT_URL)
    districts_by_code = {
        code: record
        for record in district_records
        if (code := _canonical_code(record.get("סמל יישוב"))) is not None
    }

    source_names: list[str] = []
    for record in arabic_records:
        code = _canonical_code(record.get("symbol_number"))
        district_record = districts_by_code.get(code or "")
        if code is None or district_record is None:
            continue

        district = str(district_record.get("שם מחוז") or "").strip()
        if "יהודה" in district and "שומרון" in district:
            continue
        if code == "3000":
            continue

        name = _display_name(record.get("name_in_arabic"))
        if name:
            source_names.append(name)

    return _dedupe_names(source_names), len(source_names)


def _json(value: Any, *, indent: int | None = None) -> str:
    return json.dumps(value, ensure_ascii=False, indent=indent)


def _render_typescript(
    west_bank: OrderedDict[str, list[str]],
    interior: list[str],
    interior_source_rows: int,
) -> str:
    per_governorate = {name: len(localities) for name, localities in west_bank.items()}
    pcbs_urls = [urllib.parse.urljoin(PCBS_BASE_URL, path) for _, path in PCBS_SOURCES]
    metadata = {
        "generatedOn": date.today().isoformat(),
        "pcbs": {
            "title": "Locality Statistics 2015",
            "year": 2015,
            "urls": pcbs_urls,
        },
        "dataGovIl": {
            "arabicNamesUrl": DATA_GOV_ARABIC_URL,
            "districtsUrl": DATA_GOV_DISTRICT_URL,
            "excluded": ["Judea and Samaria district", "Jerusalem locality code 3000"],
        },
    }
    counts = {
        "westBankAndJerusalem": sum(per_governorate.values()),
        "westBankByGovernorate": per_governorate,
        "interiorSourceRows": interior_source_rows,
        "interiorUniqueNames": len(interior),
    }
    return (
        "// This file is generated by scripts/generate-palestine-locations.py.\n"
        "// Do not edit it manually. Locality names can repeat across governorates,\n"
        "// so callers must retain the governorate alongside a selected locality.\n\n"
        f"export const OFFICIAL_LOCALITY_SOURCE_METADATA = {_json(metadata, indent=2)} as const;\n\n"
        f"export const WEST_BANK_LOCALITIES = {_json(west_bank, indent=2)} as const;\n\n"
        f"export const INTERIOR_LOCALITIES = {_json(interior, indent=2)} as const;\n\n"
        f"export const OFFICIAL_LOCALITY_COUNTS = {_json(counts, indent=2)} as const;\n"
    )


def main() -> None:
    west_bank: OrderedDict[str, list[str]] = OrderedDict()
    pcbs_jobs = [
        (governorate, urllib.parse.urljoin(PCBS_BASE_URL, path))
        for governorate, path in PCBS_SOURCES
    ]
    with ThreadPoolExecutor(max_workers=6) as executor:
        fetched_pcbs = list(executor.map(lambda job: _load_pcbs_localities(job[1]), pcbs_jobs))

    for (governorate, _url), localities in zip(pcbs_jobs, fetched_pcbs, strict=True):
        expected = PCBS_EXPECTED_COUNTS[governorate]
        if len(localities) != expected:
            raise RuntimeError(
                f"PCBS parsing check failed for {governorate}: expected {expected}, got {len(localities)}"
            )
        west_bank[governorate] = localities

    interior, interior_source_rows = _load_interior_localities()
    if interior_source_rows < 1_000 or len(interior) < 1_000:
        raise RuntimeError(
            "Interior locality sources returned unexpectedly few records: "
            f"{interior_source_rows} rows / {len(interior)} unique names"
        )

    output = _render_typescript(west_bank, interior, interior_source_rows)
    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(REPOSITORY_ROOT)}")
    print(f"West Bank and Jerusalem: {sum(map(len, west_bank.values()))} localities")
    print(f"Interior: {interior_source_rows} source rows, {len(interior)} unique names")


if __name__ == "__main__":
    main()
