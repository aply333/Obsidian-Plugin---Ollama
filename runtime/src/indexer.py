from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path

import ollama

STOP_WORDS = {
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

GENERIC_CATEGORY_WORDS = {
    "archive",
    "assets",
    "application",
    "applying",
    "board",
    "boards",
    "begin",
    "chat",
    "clip",
    "custom",
    "data",
    "docs",
    "document",
    "documents",
    "draft",
    "drafts",
    "file",
    "files",
    "folder",
    "folders",
    "general",
    "index",
    "kanban",
    "log",
    "logs",
    "misc",
    "miscellaneous",
    "note",
    "notes",
    "page",
    "pages",
    "project",
    "projects",
    "prompt",
    "prompts",
    "quick",
    "reference",
    "references",
    "scratch",
    "stuff",
    "task",
    "tracking",
    "temp",
    "template",
    "templates",
    "untitled",
}

PROMPT_PATH = (
    Path(__file__).resolve().parents[1] / "prompts" / "obsidian_ai_category_prompt.md"
)


def tokenize(value: str) -> list[str]:
    tokens: list[str] = []
    current = []
    for char in value.lower():
        if char.isalnum():
            current.append(char)
            continue

        if current:
            token = "".join(current).strip()
            if len(token) > 1 and token not in STOP_WORDS:
                tokens.append(token)
            current = []

    if current:
        token = "".join(current).strip()
        if len(token) > 1 and token not in STOP_WORDS:
            tokens.append(token)

    return tokens


def get_folder_path(path: str) -> str:
    return "/".join(path.split("/")[:-1]) if "/" in path else "(root)"


def get_title(path: str, markdown: str) -> str:
    body = markdown
    if body.startswith("---\n"):
        split_marker = body.find("\n---\n", 4)
        if split_marker != -1:
            body = body[split_marker + 5 :]

    for raw_line in body.splitlines():
        line = raw_line.strip()
        if line.startswith("# "):
            return line[2:].strip() or path.rsplit("/", 1)[-1].removesuffix(".md")

    return path.rsplit("/", 1)[-1].removesuffix(".md") or path


def get_excerpt(markdown: str) -> str:
    body = markdown
    if body.startswith("---\n"):
        split_marker = body.find("\n---\n", 4)
        if split_marker != -1:
            body = body[split_marker + 5 :]

    parts = [
        line.strip()
        for line in body.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    return " ".join(parts).replace("\n", " ").strip()[:280]


def get_word_count(markdown: str) -> int:
    return len([part for part in markdown.split() if part])


def extract_tags(markdown: str) -> list[str]:
    tags = {match for match in re.findall(r"(?<!\w)(#[A-Za-z0-9/_-]+)", markdown)}
    return sorted(tags)


def extract_links(markdown: str) -> list[str]:
    links = {
        match.split("|", 1)[0].strip()
        for match in re.findall(r"\[\[([^\]]+)\]\]", markdown)
        if match.strip()
    }
    return sorted(links)


def get_top_topic_pairs(entries: list[dict], limit: int) -> list[dict]:
    topic_counts: dict[str, int] = defaultdict(int)

    for entry in entries:
        topic_source = " ".join(
            [
                entry["title"],
                entry["excerpt"],
                " ".join(entry["tags"]),
                " ".join(entry.get("ai_categories", [])),
                get_folder_path(entry["path"]),
            ]
        )
        for token in set(tokenize(topic_source)):
            topic_counts[token] += 1

    return [
        {"token": token, "count": count}
        for token, count in sorted(
            topic_counts.items(),
            key=lambda item: (-item[1], item[0]),
        )[:limit]
    ]


def get_representative_paths(entries: list[dict], limit: int) -> list[str]:
    by_folder: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_folder[get_folder_path(entry["path"])].append(entry)

    selected: list[str] = []
    top_folders = sorted(
        by_folder.items(),
        key=lambda item: (-len(item[1]), item[0]),
    )[: max(limit, 6)]

    for _, folder_entries in top_folders:
        best_entry = sorted(
            folder_entries,
            key=lambda item: (-item["word_count"], item["path"]),
        )[0]
        if best_entry["path"] not in selected:
            selected.append(best_entry["path"])
        if len(selected) >= limit:
            return selected

    for entry in sorted(entries, key=lambda item: (-item["word_count"], item["path"])):
        if entry["path"] not in selected:
            selected.append(entry["path"])
        if len(selected) >= limit:
            break

    return selected


def normalize_category_name(value: str) -> str:
    candidate = value.strip().lower()
    candidate = re.sub(r"^#+", "", candidate)
    candidate = re.sub(r"\.md$", "", candidate)
    candidate = candidate.replace("_", " ").replace("/", " ")
    candidate = re.sub(r"[^a-z0-9\s-]", " ", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    if not candidate:
        return ""

    words = []
    for raw_word in candidate.split():
        if raw_word.endswith("ies") and len(raw_word) > 4:
            word = raw_word[:-3] + "y"
        elif (
            raw_word.endswith("s") and len(raw_word) > 3 and not raw_word.endswith("ss")
        ):
            word = raw_word[:-1]
        else:
            word = raw_word
        words.append(word)

    candidate = "-".join(words[:3])
    return candidate


def is_valid_category_name(value: str) -> bool:
    if not value:
        return False
    if value in GENERIC_CATEGORY_WORDS:
        return False
    if len(value) < 3 or len(value) > 48:
        return False
    if re.fullmatch(r"[0-9-]+", value):
        return False
    if re.fullmatch(r"[a-f0-9]{6,8}", value):
        return False
    if "_" in value:
        return False
    if any(char.isdigit() for char in value) and len(value.replace("-", "")) <= 6:
        return False
    return True


def match_existing_category(
    candidate: str,
    existing_categories: list[str],
) -> str:
    normalized = normalize_category_name(candidate)
    if not normalized:
        return ""
    if normalized in existing_categories:
        return normalized

    candidate_tokens = set(normalized.split("-"))
    for existing in existing_categories:
        existing_tokens = set(existing.split("-"))
        if normalized in existing or existing in normalized:
            return existing
        if candidate_tokens and candidate_tokens == existing_tokens:
            return existing
        if len(candidate_tokens & existing_tokens) >= max(
            1, min(len(candidate_tokens), len(existing_tokens))
        ):
            return existing

    return normalized


def load_category_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def build_category_prompt(
    note_source: dict,
    existing_categories: list[str],
) -> str:
    prompt_preamble = load_category_prompt()
    title = get_title(note_source["path"], note_source["markdown"])
    excerpt = get_excerpt(note_source["markdown"])
    folder = get_folder_path(note_source["path"])
    content_preview = note_source["markdown"].strip()[:4000]
    existing = ", ".join(existing_categories[:80]) or "(none yet)"

    prompt_body = "\n\n".join(
        [
            "You are classifying an Obsidian note into high-level categories.",
            "Return ONLY a JSON array of 1 to 3 category names.",
            "Categories must reflect reusable themes, not keywords or raw tokens.",
            f"Existing categories:\n{existing}",
            (
                "Note metadata:\n"
                f"- Path: {note_source['path']}\n"
                f"- Folder: {folder}\n"
                f"- Title: {title}\n"
                f"- Tags: {', '.join(note_source.get('tags', [])) or '(none)'}\n"
                f"- Excerpt: {excerpt or '(none)'}"
            ),
            f"Note content:\n{content_preview}",
        ]
    )

    return "\n\n".join(part for part in [prompt_preamble, prompt_body] if part)


def parse_category_response(raw_text: str) -> list[str]:
    cleaned_text = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    parsed = json.loads(cleaned_text)
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed]


def heuristic_category_candidates(
    note_source: dict,
    existing_categories: list[str],
) -> list[str]:
    candidates: list[str] = []
    folder_parts = [
        normalize_category_name(part)
        for part in get_folder_path(note_source["path"]).split("/")
        if part and part != "(root)"
    ]
    tag_parts = [normalize_category_name(tag) for tag in note_source.get("tags", [])]
    title_parts = [
        normalize_category_name(part)
        for part in re.split(
            r"[-:|/]", get_title(note_source["path"], note_source["markdown"])
        )
    ]

    for candidate in folder_parts + tag_parts + title_parts:
        matched = match_existing_category(candidate, existing_categories)
        if is_valid_category_name(matched) and matched not in candidates:
            candidates.append(matched)
        if len(candidates) >= 3:
            return candidates

    text_tokens = tokenize(
        " ".join(
            [
                get_title(note_source["path"], note_source["markdown"]),
                get_excerpt(note_source["markdown"]),
                " ".join(note_source.get("tags", [])),
                get_folder_path(note_source["path"]),
            ]
        )
    )
    for token in text_tokens:
        if token not in existing_categories:
            continue
        normalized = match_existing_category(token, existing_categories)
        if is_valid_category_name(normalized) and normalized not in candidates:
            candidates.append(normalized)
        if len(candidates) >= 3:
            break

    return candidates[:3]


def classify_note_categories(
    note_source: dict,
    existing_categories: list[str],
    model: str | None = None,
) -> list[str]:
    categories: list[str] = []

    chosen_model = (model or os.getenv("OLLAMA_CATEGORY_MODEL", "")).strip()
    if chosen_model:
        client = ollama.Client()
        try:
            result = client.generate(
                model=chosen_model,
                prompt=build_category_prompt(note_source, existing_categories),
            )
            raw_categories = parse_category_response(result.get("response", ""))
            for item in raw_categories:
                matched = match_existing_category(item, existing_categories)
                if is_valid_category_name(matched) and matched not in categories:
                    categories.append(matched)
                if len(categories) >= 3:
                    break
        except Exception:
            categories = []

    if not categories:
        categories = heuristic_category_candidates(note_source, existing_categories)

    return categories[:3]


def build_note_index_entry(source: dict) -> dict:
    return {
        "path": source["path"],
        "title": get_title(source["path"], source["markdown"]),
        "excerpt": get_excerpt(source["markdown"]),
        "tags": sorted(set(source.get("tags", []))),
        "links": sorted(set(source.get("links", []))),
        "ai_categories": sorted(set(source.get("ai_categories", []))),
        "word_count": get_word_count(source["markdown"]),
    }


def assign_note_categories(
    note_sources: list[dict],
    existing_categories: list[str] | None = None,
    model: str | None = None,
) -> list[dict]:
    known_categories = [
        normalize_category_name(category) for category in (existing_categories or [])
    ]
    known_categories = [
        category for category in known_categories if is_valid_category_name(category)
    ]
    assigned_sources: list[dict] = []

    for note_source in sorted(note_sources, key=lambda item: item["path"]):
        ai_categories = classify_note_categories(note_source, known_categories, model)
        for category in ai_categories:
            if category not in known_categories:
                known_categories.append(category)

        assigned_sources.append(
            {
                **note_source,
                "ai_categories": ai_categories,
            }
        )

    return assigned_sources


def build_vault_summary(entries: list[dict], file_paths: list[str]) -> str:
    folder_counts: dict[str, int] = defaultdict(int)
    tag_counts: dict[str, int] = defaultdict(int)
    category_counts: dict[str, int] = defaultdict(int)

    for path in file_paths:
        folder_counts[get_folder_path(path)] += 1

    for entry in entries:
        for tag in entry["tags"]:
            tag_counts[tag] += 1
        for category in entry.get("ai_categories", []):
            category_counts[category] += 1

    top_topics = [item["token"] for item in get_top_topic_pairs(entries, 8)]
    representative_paths = get_representative_paths(entries, 5)
    representative_lines = [
        f"- {entry['path']}: {entry['title']}"
        for entry in entries
        if entry["path"] in representative_paths
    ]

    return "\n".join(
        [
            f"Vault note count: {len(file_paths)}",
            (
                f"Vault themes: {', '.join(top_topics)}."
                if top_topics
                else "Vault themes: unavailable."
            ),
            "Top categories:",
            *(
                [
                    f"- {name}: {count} notes"
                    for name, count in sorted(
                        category_counts.items(),
                        key=lambda item: (-item[1], item[0]),
                    )[:8]
                ]
                or ["- (none)"]
            ),
            "Top folders:",
            *(
                [
                    f"- {folder}: {count} notes"
                    for folder, count in sorted(
                        folder_counts.items(),
                        key=lambda item: (-item[1], item[0]),
                    )[:5]
                ]
                or ["- (none)"]
            ),
            "Top tags:",
            *(
                [
                    f"- {tag}: {count}"
                    for tag, count in sorted(
                        tag_counts.items(),
                        key=lambda item: (-item[1], item[0]),
                    )[:8]
                ]
                or ["- (none)"]
            ),
            "Representative notes:",
            *(representative_lines or ["- (none)"]),
        ]
    )


def build_vault_map(
    entries: list[dict], file_paths: list[str], generated_at: int
) -> dict:
    folder_entry_map: dict[str, list[dict]] = defaultdict(list)
    tag_counts: dict[str, int] = defaultdict(int)
    category_counts: dict[str, int] = defaultdict(int)

    for entry in entries:
        folder_entry_map[get_folder_path(entry["path"])].append(entry)
        for tag in entry["tags"]:
            tag_counts[tag] += 1
        for category in entry.get("ai_categories", []):
            category_counts[category] += 1

    top_folders = []
    for folder, folder_entries in sorted(
        folder_entry_map.items(),
        key=lambda item: (-len(item[1]), item[0]),
    )[:8]:
        sorted_entries = sorted(
            folder_entries,
            key=lambda item: (-item["word_count"], item["path"]),
        )
        folder_categories: dict[str, int] = defaultdict(int)
        for entry in folder_entries:
            for category in entry.get("ai_categories", []):
                folder_categories[category] += 1
        top_folder_categories = [
            name
            for name, _ in sorted(
                folder_categories.items(),
                key=lambda item: (-item[1], item[0]),
            )[:3]
        ]
        folder_topics = [
            item["token"] for item in get_top_topic_pairs(folder_entries, 5)
        ]
        intent_parts = []
        if top_folder_categories:
            intent_parts.append(f"Themes: {', '.join(top_folder_categories)}")
        if folder_topics:
            intent_parts.append(f"Topics: {', '.join(folder_topics[:3])}")
        if sorted_entries[:2]:
            intent_parts.append(
                "Examples: " + ", ".join(entry["title"] for entry in sorted_entries[:2])
            )
        top_folders.append(
            {
                "folder": folder,
                "note_count": len(folder_entries),
                "sample_titles": [entry["title"] for entry in sorted_entries[:3]],
                "sample_paths": [entry["path"] for entry in sorted_entries[:3]],
                "top_topics": folder_topics,
                "intent": ". ".join(intent_parts) or "Intent unavailable.",
            }
        )

    representative_lookup = set(get_representative_paths(entries, 8))

    return {
        "generated_at": generated_at,
        "note_count": len(file_paths),
        "dominant_topics": [
            name
            for name, _ in sorted(
                category_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )[:12]
        ]
        or [item["token"] for item in get_top_topic_pairs(entries, 12)],
        "top_folders": top_folders,
        "top_tags": [
            {"tag": tag, "count": count}
            for tag, count in sorted(
                tag_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )[:12]
        ],
        "most_connected_notes": [
            {
                "note_path": entry["path"],
                "title": entry["title"],
                "link_count": len(entry["links"]),
            }
            for entry in sorted(
                entries,
                key=lambda item: (
                    -len(item["links"]),
                    -item["word_count"],
                    item["path"],
                ),
            )[:8]
        ],
        "representative_notes": [
            {"path": entry["path"], "title": entry["title"]}
            for entry in entries
            if entry["path"] in representative_lookup
        ],
    }


def index_vault(
    note_sources: list[dict],
    indexed_at: int,
    existing_categories: list[str] | None = None,
    model: str | None = None,
) -> dict:
    categorized_sources = assign_note_categories(
        note_sources, existing_categories, model
    )
    file_paths = sorted(source["path"] for source in categorized_sources)
    note_entries = [build_note_index_entry(source) for source in categorized_sources]
    note_entries.sort(key=lambda entry: entry["path"])
    vault_map = build_vault_map(note_entries, file_paths, indexed_at)
    vault_summary = build_vault_summary(note_entries, file_paths)

    return {
        "indexed_at": indexed_at,
        "file_paths": file_paths,
        "note_entries": note_entries,
        "vault_summary": vault_summary,
        "vault_map": vault_map,
    }


def index_vault_path(
    vault_path: str,
    indexed_at: int,
    existing_categories: list[str] | None = None,
    model: str | None = None,
) -> dict:
    root = Path(vault_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(
            f"Vault path does not exist or is not a directory: {vault_path}"
        )

    note_sources: list[dict] = []
    for file_path in sorted(root.rglob("*.md")):
        if not file_path.is_file():
            continue

        markdown = file_path.read_text(encoding="utf-8", errors="ignore")
        relative_path = file_path.relative_to(root).as_posix()
        note_sources.append(
            {
                "path": relative_path,
                "markdown": markdown,
                "tags": extract_tags(markdown),
                "links": extract_links(markdown),
            }
        )

    return index_vault(note_sources, indexed_at, existing_categories, model)
