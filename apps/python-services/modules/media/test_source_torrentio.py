#!/usr/bin/env python3
"""Test Torrentio source integration."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sources_torrentio import search_torrentio

def test_torrentio():
    results = search_torrentio("Inception")
    print(f"Torrentio Inception results count: {len(results)}")
    assert len(results) > 0, "Expected at least 1 result for Inception from Torrentio"
    top = results[0]
    assert "name" in top and "info_hash" in top and "seeders" in top
    print(f"Top result: {top['name']} (Seeds: {top['seeders']}, Hash: {top['info_hash']})")
    print("✅ Torrentio integration test PASSED")

if __name__ == "__main__":
    test_torrentio()
