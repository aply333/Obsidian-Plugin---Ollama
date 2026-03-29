from __future__ import annotations

import argparse
from pathlib import Path

from .manager import (
    LOG_PATH,
    check_health,
    reindex_vault,
    restart_runtime,
    start_runtime,
    stop_runtime,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Control the local Ollama runtime.")
    parser.add_argument(
        "command",
        choices=["start", "stop", "restart", "status", "logs", "index"],
        help="Control command to run.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "start":
        status = start_runtime(args.host, args.port)
    elif args.command == "stop":
        status = stop_runtime()
    elif args.command == "restart":
        status = restart_runtime(args.host, args.port)
    elif args.command == "status":
        status = check_health(args.host, args.port)
    elif args.command == "index":
        status = reindex_vault(args.host, args.port)
    else:
        print(str(Path(LOG_PATH)))
        return 0

    print(
        f"process={status.process_state} health={status.health_state} "
        f"pid={status.pid or '-'} detail={status.detail}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
