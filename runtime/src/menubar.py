from __future__ import annotations

import subprocess
import sys

from .manager import (
    CONFIG_DIR,
    DB_PATH,
    LOG_PATH,
    check_health,
    reindex_vault,
    restart_runtime,
    start_runtime,
    stop_runtime,
)

try:
    import rumps
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "rumps is required for the macOS menu bar app. "
        "Install runtime requirements first."
    ) from exc


class RuntimeMenuBarApp(rumps.App):
    def __init__(self) -> None:
        super().__init__("Ollama RT: Stopped", quit_button=None)
        self.menu = [
            "Start Runtime",
            "Stop Runtime",
            "Restart Runtime",
            "Index Vault",
            None,
            "Check Health",
            "View Files",
            "Open Logs",
            None,
            "Quit",
        ]
        self.timer = rumps.Timer(self.refresh_status, 5)
        self.timer.start()
        self.refresh_status(None)

    @rumps.clicked("Start Runtime")
    def on_start(self, _: rumps.MenuItem) -> None:
        status = start_runtime()
        rumps.notification("Ollama Runtime", "Start Runtime", status.detail)
        self.apply_status()

    @rumps.clicked("Stop Runtime")
    def on_stop(self, _: rumps.MenuItem) -> None:
        status = stop_runtime()
        rumps.notification("Ollama Runtime", "Stop Runtime", status.detail)
        self.apply_status()

    @rumps.clicked("Restart Runtime")
    def on_restart(self, _: rumps.MenuItem) -> None:
        status = restart_runtime()
        rumps.notification("Ollama Runtime", "Restart Runtime", status.detail)
        self.apply_status()

    @rumps.clicked("Check Health")
    def on_health(self, _: rumps.MenuItem) -> None:
        status = check_health()
        rumps.notification("Ollama Runtime", "Health Check", status.detail)
        self.apply_status(status)

    @rumps.clicked("Index Vault")
    def on_index(self, _: rumps.MenuItem) -> None:
        status = reindex_vault()
        rumps.notification("Ollama Runtime", "Index Vault", status.detail)
        self.apply_status()

    @rumps.clicked("View Files")
    def on_view_files(self, _: rumps.MenuItem) -> None:
        if DB_PATH.exists():
            subprocess.Popen(["open", "-R", str(DB_PATH)])
            return
        subprocess.Popen(["open", str(CONFIG_DIR)])

    @rumps.clicked("Open Logs")
    def on_logs(self, _: rumps.MenuItem) -> None:
        subprocess.Popen(["open", str(LOG_PATH)])

    @rumps.clicked("Quit")
    def on_quit(self, _: rumps.MenuItem) -> None:
        self.timer.stop()
        rumps.quit_application()

    def refresh_status(self, _: rumps.Timer | None) -> None:
        self.apply_status()

    def apply_status(self, status=None) -> None:
        status = status or check_health()
        if status.process_state != "running":
            self.title = "Ollama RT: Stopped"
        elif status.health_state == "ok":
            self.title = "Ollama RT: Running"
        elif status.health_state == "degraded":
            self.title = "Ollama RT: Degraded"
        else:
            self.title = "Ollama RT: Starting"


def main() -> int:
    app = RuntimeMenuBarApp()
    app.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
