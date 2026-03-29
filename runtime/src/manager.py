from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT_DIR / "runtime" / "config"
PID_PATH = CONFIG_DIR / "runtime.pid"
STATE_PATH = CONFIG_DIR / "runtime-state.json"
LOG_PATH = CONFIG_DIR / "runtime.log"
DB_PATH = CONFIG_DIR / "runtime.db"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


@dataclass
class RuntimeStatus:
    process_state: str
    health_state: str
    pid: int | None
    detail: str


def ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def read_pid() -> int | None:
    if not PID_PATH.exists():
        return None

    try:
        return int(PID_PATH.read_text().strip())
    except ValueError:
        return None


def write_pid(pid: int) -> None:
    ensure_config_dir()
    PID_PATH.write_text(f"{pid}\n")


def clear_pid() -> None:
    PID_PATH.unlink(missing_ok=True)


def is_process_running(pid: int | None) -> bool:
    if not pid:
        return False

    try:
        os.kill(pid, 0)
    except OSError:
        return False

    return True


def write_state(status: RuntimeStatus) -> None:
    ensure_config_dir()
    STATE_PATH.write_text(
        json.dumps(
            {
                "process_state": status.process_state,
                "health_state": status.health_state,
                "pid": status.pid,
                "detail": status.detail,
                "updated_at": time.time(),
            },
            indent=2,
        )
        + "\n"
    )


def read_state() -> RuntimeStatus | None:
    if not STATE_PATH.exists():
        return None

    try:
        raw = json.loads(STATE_PATH.read_text())
        return RuntimeStatus(
            process_state=raw.get("process_state", "stopped"),
            health_state=raw.get("health_state", "unknown"),
            pid=raw.get("pid"),
            detail=raw.get("detail", ""),
        )
    except (OSError, json.JSONDecodeError):
        return None


def get_runtime_url(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> str:
    return f"http://{host}:{port}"


def check_health(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> RuntimeStatus:
    pid = read_pid()
    process_running = is_process_running(pid)

    if not process_running:
        clear_pid()
        status = RuntimeStatus(
            process_state="stopped",
            health_state="offline",
            pid=None,
            detail="Runtime process is not running.",
        )
        write_state(status)
        return status

    try:
        response = httpx.get(
            f"{get_runtime_url(host, port)}/health",
            timeout=2.0,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        status = RuntimeStatus(
            process_state="running",
            health_state="starting",
            pid=pid,
            detail=f"Runtime process is up but health check failed: {exc}",
        )
        write_state(status)
        return status

    health_state = "ok" if data.get("ollama_reachable") else "degraded"
    detail = (
        "Runtime is running and Ollama is reachable."
        if health_state == "ok"
        else "Runtime is running but Ollama is unavailable."
    )
    status = RuntimeStatus(
        process_state="running",
        health_state=health_state,
        pid=pid,
        detail=detail,
    )
    write_state(status)
    return status


def start_runtime(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> RuntimeStatus:
    ensure_config_dir()
    current_pid = read_pid()
    if is_process_running(current_pid):
        return check_health(host, port)

    log_handle = LOG_PATH.open("a", encoding="utf-8")
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "runtime.src.app:app",
        "--host",
        host,
        "--port",
        str(port),
    ]
    process = subprocess.Popen(
        command,
        cwd=ROOT_DIR,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    write_pid(process.pid)

    status = RuntimeStatus(
        process_state="running",
        health_state="starting",
        pid=process.pid,
        detail="Runtime process started. Waiting for health check.",
    )
    write_state(status)
    return status


def stop_runtime() -> RuntimeStatus:
    pid = read_pid()
    if not is_process_running(pid):
        clear_pid()
        status = RuntimeStatus(
            process_state="stopped",
            health_state="offline",
            pid=None,
            detail="Runtime was already stopped.",
        )
        write_state(status)
        return status

    assert pid is not None
    os.killpg(pid, signal.SIGTERM)

    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_process_running(pid):
            break
        time.sleep(0.1)

    if is_process_running(pid):
        os.killpg(pid, signal.SIGKILL)

    clear_pid()
    status = RuntimeStatus(
        process_state="stopped",
        health_state="offline",
        pid=None,
        detail="Runtime stopped.",
    )
    write_state(status)
    return status


def restart_runtime(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
) -> RuntimeStatus:
    stop_runtime()
    return start_runtime(host, port)


def reindex_vault(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
) -> RuntimeStatus:
    status = check_health(host, port)
    if status.process_state != "running":
        return RuntimeStatus(
            process_state="stopped",
            health_state="offline",
            pid=status.pid,
            detail="Cannot reindex because the runtime is not running.",
        )

    try:
        response = httpx.post(
            f"{get_runtime_url(host, port)}/context/reindex",
            json={},
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return RuntimeStatus(
            process_state="running",
            health_state=status.health_state,
            pid=status.pid,
            detail=f"Runtime reindex failed: {exc}",
        )

    return RuntimeStatus(
        process_state="running",
        health_state=status.health_state,
        pid=status.pid,
        detail=(
            f"Reindexed {len(data.get('file_paths', []))} notes from "
            f"{data.get('source', 'stored vault path')}."
        ),
    )
