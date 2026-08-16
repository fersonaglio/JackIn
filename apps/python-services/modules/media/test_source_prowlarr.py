#!/usr/bin/env python3
"""Offline unit test for sources_prowlarr (no network required)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sources_prowlarr

MOCK_ITEMS = [
    {
        "title": "Example Movie 2024 1080p BluRay x264",
        "seeders": 42,
        "size": 2147483648,
        "magnetUrl": "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=example",
        "infoHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "indexer": "ExampleIndexer",
    },
    {
        "title": "Series S01E01 720p WEB",
        "seeders": "7",
        "size": 1048576000,
        "magnetUrl": "magnet:?xt=urn:btih:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&dn=series",
        "indexer": "AnotherIndexer",
    },
    {
        "title": "Hash From Magnet 2160p",
        "magnetUrl": "magnet:?xt=urn:btih:CcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc&dn=magnet",
        "size": 8589934592,
        "indexer": "MagnetOnlyIndexer",
    },
    {
        "title": "Missing Metadata",
        "indexer": "BareIndexer",
    },
    {
        "title": "No Hash At All 480p",
        "magnetUrl": "magnet:?xt=urn:sha1:XXXXXXXXXXXX&dn=nohash",
        "size": 1048576,
        "indexer": "NoHashIndexer",
    },
    "not-a-dict",
    None,
]

EXPECTED = {
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": ("Example Movie 2024 1080p BluRay x264", "42", "2147483648"),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": ("Series S01E01 720p WEB", "7", "1048576000"),
    "cccccccccccccccccccccccccccccccccccccccc": ("Hash From Magnet 2160p", "0", "8589934592"),
}


def _check_common(item: dict) -> bool:
    if sorted(item.keys()) != ["info_hash", "name", "seeders", "size"]:
        return False
    if not isinstance(item["info_hash"], str) or len(item["info_hash"]) != 40:
        return False
    if item["info_hash"] != item["info_hash"].lower():
        return False
    if not isinstance(item["seeders"], str) or not item["seeders"].isdigit():
        return False
    if not isinstance(item["size"], str) or not item["size"].isdigit():
        return False
    return True


def main() -> int:
    failures = []

    # Sanity: parse mock without network.
    result = sources_prowlarr.parse_prowlarr_response(MOCK_ITEMS)
    by_hash = {i["info_hash"]: i for i in result}

    # Only the three valid items should survive.
    if sorted(by_hash) != sorted(EXPECTED):
        failures.append(f"unexpected surviving hashes: {sorted(by_hash)}")

    for info_hash, (name, seeders, size) in EXPECTED.items():
        item = by_hash.get(info_hash)
        if item is None:
            failures.append(f"missing expected item {info_hash}")
            continue
        if not _check_common(item):
            failures.append(f"bad shape for {info_hash}: {item}")
        if item["name"] != name:
            failures.append(f"name mismatch for {info_hash}: {item['name']!r} != {name!r}")
        if item["seeders"] != seeders:
            failures.append(f"seeders mismatch for {info_hash}: {item['seeders']!r} != {seeders!r}")
        if item["size"] != size:
            failures.append(f"size mismatch for {info_hash}: {item['size']!r} != {size!r}")

    # Disabled -> no network.
    import os
    os.environ["ENABLE_PROWLARR"] = "0"
    if sources_prowlarr.search_prowlarr("anything") != []:
        failures.append("ENABLE_PROWLARR=0 should return []")
    os.environ.pop("ENABLE_PROWLARR", None)

    # Missing API key -> no network.
    os.environ.pop("PROWLARR_API_KEY", None)
    if sources_prowlarr.search_prowlarr("anything") != []:
        failures.append("missing PROWLARR_API_KEY should return []")
    os.environ["PROWLARR_API_KEY"] = "test"

    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1

    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
