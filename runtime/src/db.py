from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT_DIR / "runtime" / "config"
DB_PATH = CONFIG_DIR / "runtime.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    type TEXT CHECK(type IN ('note', 'folder')) NOT NULL,
    parent_path TEXT,
    ai_categories TEXT,
    user_categories TEXT,
    summary TEXT,
    last_modified DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    summary TEXT,
    source TEXT CHECK(source IN ('ai', 'user')) NOT NULL,
    related_notes TEXT,
    count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action TEXT,
    target_path TEXT,
    summary TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    type TEXT CHECK(type IN ('open', 'multiple_choice', 'boolean')) NOT NULL,
    category TEXT
);
"""


@dataclass
class RuntimeCategory:
    name: str
    summary: str
    source: str
    related_notes: list[str]
    count: int = 1


def ensure_db() -> Path:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.executescript(SCHEMA)
        category_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(categories)").fetchall()
        }
        if "count" not in category_columns:
            connection.execute(
                "ALTER TABLE categories ADD COLUMN count INTEGER DEFAULT 1"
            )
    return DB_PATH


def get_connection() -> sqlite3.Connection:
    ensure_db()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=True)


def tokenize(value: str) -> list[str]:
    tokens: list[str] = []
    current = []
    stop_words = {
        "a",
        "about",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "can",
        "describe",
        "for",
        "from",
        "how",
        "i",
        "in",
        "is",
        "it",
        "me",
        "my",
        "of",
        "on",
        "or",
        "overview",
        "tell",
        "that",
        "the",
        "this",
        "through",
        "to",
        "vault",
        "what",
        "with",
        "you",
    }

    for char in value.lower():
        if char.isalnum():
            current.append(char)
            continue
        if current:
            token = "".join(current).strip()
            if len(token) > 1 and token not in stop_words:
                tokens.append(token)
            current = []

    if current:
        token = "".join(current).strip()
        if len(token) > 1 and token not in stop_words:
            tokens.append(token)

    return tokens


def is_vault_overview_query(query: str) -> bool:
    normalized = query.lower()
    phrases = [
        "tell me about this vault",
        "what can you tell me about this vault",
        "summarize this vault",
        "summarise this vault",
        "overview of this vault",
        "what is in this vault",
        "describe this vault",
    ]
    return any(phrase in normalized for phrase in phrases) or (
        "vault" in normalized
        and any(
            item in normalized
            for item in [
                "summary",
                "summarize",
                "summarise",
                "overview",
                "describe",
                "tell me about",
            ]
        )
    )


def get_representative_note_paths(limit: int, excluded_paths: set[str]) -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT path, parent_path
            FROM vault_map
            WHERE type = 'note'
            ORDER BY parent_path ASC, LENGTH(summary) DESC, path ASC
            """
        ).fetchall()

    by_folder: dict[str, list[str]] = {}
    for row in rows:
        path = row["path"]
        if path in excluded_paths:
            continue
        folder = row["parent_path"] or "(root)"
        by_folder.setdefault(folder, []).append(path)

    selected: list[str] = []
    for _, paths in sorted(
        by_folder.items(), key=lambda item: (-len(item[1]), item[0])
    ):
        if paths[0] not in selected:
            selected.append(paths[0])
        if len(selected) >= limit:
            return selected

    for row in rows:
        path = row["path"]
        if path not in excluded_paths and path not in selected:
            selected.append(path)
        if len(selected) >= limit:
            break

    return selected


def retrieve_relevant_note_paths(
    query: str,
    excluded_paths: list[str] | None = None,
    limit: int = 4,
) -> list[str]:
    excluded = set(excluded_paths or [])
    if is_vault_overview_query(query):
        return get_representative_note_paths(max(limit, 6), excluded)

    query_tokens = tokenize(query)
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT path, name, summary, ai_categories
            FROM vault_map
            WHERE type = 'note'
            """
        ).fetchall()

    scored: list[tuple[str, int, int]] = []
    for row in rows:
        path = row["path"]
        if path in excluded:
            continue

        ai_categories = row["ai_categories"] or "[]"
        try:
            categories = json.loads(ai_categories)
        except json.JSONDecodeError:
            categories = []

        haystack = " \n ".join(
            [
                path,
                row["name"] or "",
                row["summary"] or "",
                " ".join(categories),
            ]
        ).lower()

        score = 0
        for token in query_tokens:
            if token in (row["name"] or "").lower():
                score += 8
            if token in path.lower():
                score += 6
            if any(token in str(category).lower() for category in categories):
                score += 5
            if token in haystack:
                score += 2

        scored.append((path, score, len(row["summary"] or "")))

    scored.sort(key=lambda item: (-item[1], -item[2], item[0]))

    if not query_tokens or not any(score > 0 for _, score, _ in scored):
        return get_representative_note_paths(min(limit, 4), excluded)

    return [path for path, score, _ in scored if score > 0][:limit]


def get_table_snapshot(limit: int = 25) -> dict[str, list[dict]]:
    snapshot: dict[str, list[dict]] = {}
    with get_connection() as connection:
        for table_name in ["vault_map", "categories", "change_log", "questions"]:
            rows = connection.execute(
                f"SELECT * FROM {table_name} ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            snapshot[table_name] = [dict(row) for row in rows]

    return snapshot


def set_metadata(key: str, value: str) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO metadata (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )


def get_metadata(key: str) -> str | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT value FROM metadata WHERE key = ?",
            (key,),
        ).fetchone()

    if not row:
        return None
    value = str(row["value"]).strip()
    return value or None


def get_last_vault_path() -> str | None:
    return get_metadata("last_vault_path")


def get_user_context_items() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT name FROM categories WHERE source = 'user' ORDER BY id ASC"
        ).fetchall()

    return [str(row["name"]).strip() for row in rows if str(row["name"]).strip()]


def get_existing_ai_category_names() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT name FROM categories WHERE source = 'ai' ORDER BY count DESC, name ASC"
        ).fetchall()

    return [str(row["name"]).strip() for row in rows if str(row["name"]).strip()]


def get_folder_contexts() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT path, name, summary, ai_categories
            FROM vault_map
            WHERE type = 'folder' AND path != '/'
            ORDER BY path ASC
            """
        ).fetchall()

    contexts: list[dict[str, object]] = []
    for row in rows:
        try:
            ai_categories = json.loads(row["ai_categories"] or "[]")
        except json.JSONDecodeError:
            ai_categories = []

        contexts.append(
            {
                "path": row["path"],
                "name": row["name"],
                "summary": row["summary"] or "",
                "ai_categories": ai_categories,
            }
        )

    return contexts


def get_context_meta() -> dict[str, object]:
    with get_connection() as connection:
        note_count_row = connection.execute(
            "SELECT COUNT(*) AS count FROM vault_map WHERE type = 'note'"
        ).fetchone()

    return {
        "database_path": str(DB_PATH),
        "last_vault_path": get_last_vault_path(),
        "last_indexed_at": get_metadata("last_indexed_at"),
        "note_count": int(note_count_row["count"]) if note_count_row else 0,
    }


def replace_runtime_context(payload: dict) -> None:
    with get_connection() as connection:
        previous_user_categories = {
            row["path"]: row["user_categories"]
            for row in connection.execute(
                "SELECT path, user_categories FROM vault_map WHERE user_categories IS NOT NULL"
            ).fetchall()
        }
        previous_ai_counts = {
            str(row["name"]): int(row["count"] or 0)
            for row in connection.execute(
                "SELECT name, count FROM categories WHERE source = 'ai'"
            ).fetchall()
        }
        connection.execute("BEGIN")
        if payload.get("vault_path"):
            connection.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('last_vault_path', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(payload["vault_path"]).strip(),),
            )
        if payload.get("indexed_at") is not None:
            connection.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('last_indexed_at', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(payload["indexed_at"]),),
            )
        if payload.get("model"):
            connection.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('last_index_model', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(payload["model"]).strip(),),
            )
        connection.execute("DELETE FROM vault_map")
        connection.execute(
            "DELETE FROM categories WHERE source = 'ai' OR source = 'user'"
        )
        connection.execute(
            """
            INSERT INTO vault_map (
                name, path, type, parent_path, ai_categories, user_categories,
                summary, last_modified
            )
            VALUES (?, ?, 'folder', ?, ?, ?, ?, ?)
            """,
            (
                "Vault",
                "/",
                None,
                json_text(payload["vault_map"]["dominant_topics"]),
                previous_user_categories.get("/", json_text([])),
                payload["vault_summary"],
                payload["indexed_at"],
            ),
        )

        for note in payload["note_entries"]:
            parent_path = (
                note["path"].split("/")[:-1] and "/".join(note["path"].split("/")[:-1])
            ) or None
            connection.execute(
                """
                INSERT INTO vault_map (
                    name, path, type, parent_path, ai_categories, user_categories,
                    summary, last_modified
                )
                VALUES (?, ?, 'note', ?, ?, ?, ?, ?)
                """,
                (
                    note["title"],
                    note["path"],
                    parent_path,
                    json_text(note.get("ai_categories", [])),
                    previous_user_categories.get(note["path"], json_text([])),
                    note["excerpt"],
                    payload["indexed_at"],
                ),
            )

        for folder in payload["vault_map"]["top_folders"]:
            parent_path = (
                folder["folder"].split("/")[:-1]
                and "/".join(folder["folder"].split("/")[:-1])
            ) or None
            connection.execute(
                """
                INSERT INTO vault_map (
                    name, path, type, parent_path, ai_categories, user_categories,
                    summary, last_modified
                )
                VALUES (?, ?, 'folder', ?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    name = excluded.name,
                    parent_path = excluded.parent_path,
                    ai_categories = excluded.ai_categories,
                    summary = excluded.summary,
                    last_modified = excluded.last_modified
                """,
                (
                    folder["folder"].split("/")[-1] or folder["folder"],
                    folder["folder"],
                    parent_path,
                    json_text(folder["top_topics"]),
                    previous_user_categories.get(folder["folder"], json_text([])),
                    folder.get("intent")
                    or (
                        f"{folder['note_count']} notes. "
                        f"Sample titles: {', '.join(folder['sample_titles']) or 'none'}"
                    ),
                    payload["indexed_at"],
                ),
            )

        category_note_map: dict[str, list[str]] = {}
        for note in payload["note_entries"]:
            note_path = str(note["path"]).strip()
            for raw_category in note.get("ai_categories", []):
                category_name = str(raw_category).strip()
                if not category_name:
                    continue
                bucket = category_note_map.setdefault(category_name, [])
                if note_path not in bucket:
                    bucket.append(note_path)

        categories: list[RuntimeCategory] = [
            RuntimeCategory(
                name=name,
                summary=f"Observed across {len(related_notes)} indexed notes.",
                source="ai",
                related_notes=related_notes,
                count=max(len(related_notes), previous_ai_counts.get(name, 0)),
            )
            for name, related_notes in sorted(
                category_note_map.items(),
                key=lambda item: (-len(item[1]), item[0]),
            )
        ]
        categories.extend(
            RuntimeCategory(
                name=item,
                summary="Manual context item supplied by the plugin.",
                source="user",
                related_notes=[],
                count=1,
            )
            for item in payload.get("manual_context_items", [])
        )

        for category in categories:
            connection.execute(
                """
                INSERT INTO categories (name, summary, source, related_notes, count)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    summary = excluded.summary,
                    source = excluded.source,
                    related_notes = excluded.related_notes,
                    count = excluded.count
                """,
                (
                    category.name,
                    category.summary,
                    category.source,
                    json_text(category.related_notes),
                    category.count,
                ),
            )

        connection.execute(
            """
            INSERT INTO change_log (action, target_path, summary)
            VALUES (?, ?, ?)
            """,
            (
                "context_sync",
                "vault",
                (
                    f"Synchronized {len(payload['note_entries'])} notes, "
                    f"{len(payload['vault_map']['top_folders'])} folders, "
                    f"and {len(payload.get('manual_context_items', []))} manual context items."
                ),
            ),
        )
