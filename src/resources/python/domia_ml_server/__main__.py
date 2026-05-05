import argparse
import logging
import os

import uvicorn

from .app import build_app


def parse_warm(value: str) -> list[str]:
    if not value:
        return []
    return [v.strip().upper() for v in value.split(",") if v.strip()]


def main():
    parser = argparse.ArgumentParser(description="DOMIA ML inference server")
    parser.add_argument("--host", default=os.environ.get("DOMIA_ML_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("DOMIA_ML_PORT", "5051"))
    )
    parser.add_argument(
        "--warm",
        default=os.environ.get("DOMIA_ML_WARM", ""),
        help="Comma-separated engine names to load at startup (e.g. KOKORO,WHISPER)",
    )
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level.upper())
    app = build_app(warm=parse_warm(args.warm))
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
