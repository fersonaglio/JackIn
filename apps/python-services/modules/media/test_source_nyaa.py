#!/usr/bin/env python3
"""Offline unit tests for sources_nyaa (no network required).

Run with: python3 test_source_nyaa.py
Prints PASS/FAIL per assertion and exits 0 only if everything passes.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sources_nyaa  # noqa: E402

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Nyaa</title>
    <link>https://nyaa.si/</link>
    <description>Nyaa</description>
    <item>
      <title>My Movie (2026) 1080p DUBLADO</title>
      <guid>https://nyaa.si/view/1111111</guid>
      <link>https://nyaa.si/view/1111111</link>
      <dc:date>2026-01-01T00:00:00+00:00</dc:date>
      <nyaa:infoHash>ABCDEF0123456789ABCDEF0123456789ABCDEF01</nyaa:infoHash>
      <nyaa:seeders>42</nyaa:seeders>
      <nyaa:leechers>7</nyaa:leechers>
      <nyaa:downloads>999</nyaa:downloads>
      <nyaa:size>1.2 GiB</nyaa:size>
      <nyaa:category>1_2</nyaa:category>
      <nyaa:name>My Movie (2026) 1080p DUBLADO</nyaa:name>
      <nyaa:trusted>No</nyaa:trusted>
      <nyaa:remake>No</nyaa:remake>
    </item>
    <item>
      <title>My Movie (2026) 720p LEGENDADO</title>
      <guid>https://nyaa.si/view/2222222</guid>
      <link>https://nyaa.si/view/2222222</link>
      <dc:date>2026-01-01T00:00:00+00:00</dc:date>
      <nyaa:infoHash>1234567890ABCDEF1234567890ABCDEF12345678</nyaa:infoHash>
      <nyaa:seeders>0</nyaa:seeders>
      <nyaa:leechers>0</nyaa:leechers>
      <nyaa:downloads>0</nyaa:downloads>
      <nyaa:size>900.5 MiB</nyaa:size>
      <nyaa:category>1_2</nyaa:category>
    </item>
    <item>
      <title>My Movie (2026) NO HASH</title>
      <nyaa:seeders>1</nyaa:seeders>
      <nyaa:size>500 MiB</nyaa:size>
    </item>
    <item>
      <title>My Movie (2026) BAD HASH</title>
      <nyaa:infoHash>xyz</nyaa:infoHash>
      <nyaa:seeders>2</nyaa:seeders>
      <nyaa:size>500 MiB</nyaa:size>
    </item>
  </channel>
</rss>
"""


def run():
    failures = []

    def check(label, cond):
        if cond:
            print(f"PASS: {label}")
        else:
            print(f"FAIL: {label}")
            failures.append(label)

    check("parse_size 1.2 GiB", sources_nyaa.parse_size("1.2 GiB") == int(1.2 * 1073741824))
    check("parse_size 500 MiB", sources_nyaa.parse_size("500 MiB") == 500 * 1048576)
    check("parse_size 900.5 MiB", sources_nyaa.parse_size("900.5 MiB") == int(900.5 * 1048576))
    check("parse_size 1 GiB exact", sources_nyaa.parse_size("1 GiB") == 1073741824)
    check("parse_size 1 KiB", sources_nyaa.parse_size("1 KiB") == 1024)
    check("parse_size case-insensitive", sources_nyaa.parse_size("2 gib") == 2 * 1073741824)
    check("parse_size no unit", sources_nyaa.parse_size("banana") == 0)
    check("parse_size empty", sources_nyaa.parse_size("") == 0)

    items = sources_nyaa.parse_rss(SAMPLE_RSS)
    check("parse_rss skips invalid hashes (2 of 4)", len(items) == 2)

    first = items[0]
    check("parse_rss name", first["name"] == "My Movie (2026) 1080p DUBLADO")
    check("parse_rss seeders", first["seeders"] == "42")
    check("parse_rss size bytes", first["size"] == str(int(1.2 * 1073741824)))
    check("parse_rss hash lowercase", first["info_hash"] == "abcdef0123456789abcdef0123456789abcdef01")

    second = items[1]
    check("parse_rss default seeders 0", second["seeders"] == "0")
    check("parse_rss 900.5 MiB bytes", second["size"] == str(int(900.5 * 1048576)))

    check("parse_rss invalid xml returns []", sources_nyaa.parse_rss("<not-xml") == [])
    check("parse_rss empty string returns []", sources_nyaa.parse_rss("") == [])

    dedup = sources_nyaa._merge([
        {"name": "a", "seeders": "5", "size": "1", "info_hash": "ab"},
        {"name": "b", "seeders": "9", "size": "2", "info_hash": "ab"},
        {"name": "c", "seeders": "1", "size": "3", "info_hash": "cd"},
        {"name": "d", "seeders": "1", "size": "4", "info_hash": ""},
    ])
    check("merge dedups by hash keeping most seeders", len(dedup) == 2)
    by_hash = {t["info_hash"]: t["seeders"] for t in dedup}
    check("merge keeps highest seeders", by_hash.get("ab") == "9")
    check("merge keeps unique hashes", by_hash.get("cd") == "1")

    print()
    if failures:
        print(f"RESULT: FAIL ({len(failures)} failed)")
        return 1
    print("RESULT: ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())
