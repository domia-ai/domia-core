import asyncio
from typing import Dict


_locks: Dict[str, asyncio.Lock] = {}


def get(engine: str) -> asyncio.Lock:
    key = engine.upper()
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]
