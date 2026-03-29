import json
import time
from contextlib import suppress

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .db import (
    DB_PATH,
    ensure_db,
    get_context_meta,
    get_existing_ai_category_names,
    get_folder_contexts,
    get_last_vault_path,
    get_metadata,
    get_table_snapshot,
    get_user_context_items,
    replace_runtime_context,
    retrieve_relevant_note_paths,
)
from .indexer import classify_note_categories, index_vault, index_vault_path


class HealthResponse(BaseModel):
    status: str
    ollama_reachable: bool
    database_ready: bool = True


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1)


class GenerateResponse(BaseModel):
    model: str
    response: str


class QuickEntryRequest(BaseModel):
    entry_text: str = Field(min_length=1)
    model: str = Field(min_length=1)
    existing_folders: list[str] = Field(default_factory=list)


class QuickEntryResponse(BaseModel):
    note_title: str
    target_folder: str
    note_body: str
    log_summary: str
    tags: list[str] = Field(default_factory=list)
    inferred_categories: list[str] = Field(default_factory=list)
    placement_confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    placement_reason: str = ""


class NoteReference(BaseModel):
    path: str
    content: str


class NoteActionOperation(BaseModel):
    action: str = Field(pattern="^(create|update)$")
    path: str = Field(min_length=1)
    content: str = Field(min_length=1)
    summary: str = Field(min_length=1)


class NoteActionPlanRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1)
    referenced_notes: list[NoteReference] = Field(default_factory=list)


class NoteActionPlanResponse(BaseModel):
    summary: str
    operations: list[NoteActionOperation] = Field(default_factory=list)
    requires_confirmation: bool = True


class KanbanBoardReference(BaseModel):
    path: str
    content: str


class KanbanActionOperation(BaseModel):
    action: str = Field(pattern="^(create_card|move_card|update_card)$")
    board_path: str = Field(min_length=1)
    source_lane_title: str = ""
    target_lane_title: str = ""
    card_title: str = Field(min_length=1)
    new_card_title: str = ""
    summary: str = Field(min_length=1)


class KanbanActionPlanRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1)
    boards: list[KanbanBoardReference] = Field(default_factory=list)


class KanbanActionPlanResponse(BaseModel):
    summary: str
    operations: list[KanbanActionOperation] = Field(default_factory=list)
    requires_confirmation: bool = True


class AgentAction(BaseModel):
    type: str = Field(
        pattern=(
            "^(note_create|note_update|kanban_card_create|"
            "kanban_card_move|kanban_card_update)$"
        )
    )
    path: str = ""
    content: str = ""
    board_path: str = ""
    source_lane_title: str = ""
    target_lane_title: str = ""
    card_title: str = ""
    new_card_title: str = ""
    summary: str = Field(min_length=1)


class AgentActionPlanRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1)
    referenced_notes: list[NoteReference] = Field(default_factory=list)
    boards: list[KanbanBoardReference] = Field(default_factory=list)


class AgentActionPlanResponse(BaseModel):
    summary: str
    actions: list[AgentAction] = Field(default_factory=list)
    requires_confirmation: bool = True


class SyncNoteEntry(BaseModel):
    path: str
    title: str
    excerpt: str
    tags: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    ai_categories: list[str] = Field(default_factory=list)
    word_count: int = 0


class SyncVaultMapFolder(BaseModel):
    folder: str
    note_count: int
    sample_titles: list[str] = Field(default_factory=list)
    sample_paths: list[str] = Field(default_factory=list)
    top_topics: list[str] = Field(default_factory=list)
    intent: str = ""


class SyncVaultMapTag(BaseModel):
    tag: str
    count: int


class SyncVaultMapLink(BaseModel):
    note_path: str
    title: str
    link_count: int


class SyncRepresentativeNote(BaseModel):
    path: str
    title: str


class SyncVaultMap(BaseModel):
    generated_at: int
    note_count: int
    dominant_topics: list[str] = Field(default_factory=list)
    top_folders: list[SyncVaultMapFolder] = Field(default_factory=list)
    top_tags: list[SyncVaultMapTag] = Field(default_factory=list)
    most_connected_notes: list[SyncVaultMapLink] = Field(default_factory=list)
    representative_notes: list[SyncRepresentativeNote] = Field(default_factory=list)


class ContextSyncRequest(BaseModel):
    indexed_at: int | None = None
    vault_summary: str = ""
    vault_map: SyncVaultMap
    note_entries: list[SyncNoteEntry] = Field(default_factory=list)
    manual_context_items: list[str] = Field(default_factory=list)


class ContextSyncResponse(BaseModel):
    status: str
    database_path: str
    note_count: int
    folder_count: int


class NoteSourceRequest(BaseModel):
    path: str
    markdown: str
    tags: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class ContextIndexRequest(BaseModel):
    indexed_at: int
    vault_path: str = ""
    model: str = ""
    note_sources: list[NoteSourceRequest] = Field(default_factory=list)
    manual_context_items: list[str] = Field(default_factory=list)


class ContextIndexResponse(BaseModel):
    indexed_at: int
    file_paths: list[str] = Field(default_factory=list)
    note_entries: list[SyncNoteEntry] = Field(default_factory=list)
    vault_summary: str
    vault_map: SyncVaultMap
    database_path: str


class ContextReindexRequest(BaseModel):
    vault_path: str = ""
    model: str = ""


class ContextReindexResponse(ContextIndexResponse):
    source: str


class ContextRetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    excluded_paths: list[str] = Field(default_factory=list)
    limit: int = Field(default=4, ge=1, le=12)


class ContextRetrieveResponse(BaseModel):
    paths: list[str] = Field(default_factory=list)


class ContextTablesResponse(BaseModel):
    vault_map: list[dict] = Field(default_factory=list)
    categories: list[dict] = Field(default_factory=list)
    change_log: list[dict] = Field(default_factory=list)
    questions: list[dict] = Field(default_factory=list)


class ContextMetaResponse(BaseModel):
    database_path: str
    last_vault_path: str | None = None
    last_indexed_at: str | None = None
    note_count: int = 0


app = FastAPI(title="Ollama Runtime", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    await run_in_threadpool(ensure_db)


def get_client() -> ollama.Client:
    return ollama.Client()


def build_quick_entry_prompt(
    entry_text: str,
    existing_folders: list[str],
    folder_contexts: list[dict[str, object]],
) -> str:
    folder_lookup = {
        str(item["path"]): item
        for item in folder_contexts
        if str(item.get("path", "")).strip()
    }
    folder_lines = []
    for folder in existing_folders:
        context = folder_lookup.get(folder)
        if context:
            folder_lines.append(
                f"- {folder}: {str(context.get('summary', '')).strip() or 'No stored intent.'}"
            )
        else:
            folder_lines.append(f"- {folder}")
    folders = "\n".join(folder_lines) if folder_lines else "- Quick Entries"

    return "\n\n".join(
        [
            "You are organizing a quick capture for an Obsidian vault.",
            "Choose a sensible target folder based on the content.",
            "Use the provided folder intent summaries when deciding where the note belongs.",
            "Prefer an existing folder from the provided list when it fits.",
            "If nothing fits, use 'Needs Home'.",
            "Return strict JSON only. No markdown fences. No commentary.",
            (
                'Use this shape: {"note_title":"...","target_folder":"...",'
                '"note_body":"...","log_summary":"...","tags":["..."]}'
            ),
            f"Available folders:\n{folders}",
            f"Quick entry content:\n{entry_text.strip()}",
        ]
    )


def parse_quick_entry_response(raw_text: str) -> QuickEntryResponse:
    cleaned_text = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    parsed = json.loads(cleaned_text)
    return QuickEntryResponse.model_validate(parsed)


def tokenize_for_similarity(value: str) -> set[str]:
    return {token for token in value.lower().split() if token.strip()}


def compute_quick_entry_confidence(
    target_folder: str,
    entry_text: str,
    inferred_categories: list[str],
    folder_contexts: list[dict[str, object]],
) -> tuple[float, str]:
    normalized_target = target_folder.strip().strip("/")
    if not normalized_target:
        return 0.0, "No folder was selected."

    folder_context = next(
        (
            item
            for item in folder_contexts
            if str(item.get("path", "")).strip().lower() == normalized_target.lower()
        ),
        None,
    )
    if not folder_context:
        if normalized_target.lower() in {"quick entries", "needs home"}:
            return (
                0.8,
                "Using a safe catch-all folder because no indexed intent is available.",
            )
        return 0.35, "Folder has no indexed intent, so placement confidence is low."

    summary_text = str(folder_context.get("summary", "")).strip()
    folder_categories = [
        str(item).strip().lower()
        for item in folder_context.get("ai_categories", [])
        if str(item).strip()
    ]
    category_overlap = 0.0
    if inferred_categories:
        shared = {
            category.lower()
            for category in inferred_categories
            if category.lower() in set(folder_categories)
        }
        category_overlap = len(shared) / max(len(inferred_categories), 1)

    entry_tokens = tokenize_for_similarity(entry_text)
    folder_tokens = tokenize_for_similarity(
        " ".join([normalized_target.replace("/", " "), summary_text])
    )
    semantic_overlap = (
        len(entry_tokens & folder_tokens) / max(len(entry_tokens), 1)
        if entry_tokens and folder_tokens
        else 0.0
    )
    intent_overlap = 1.0 if summary_text else 0.4
    confidence = min(
        1.0,
        (intent_overlap * 0.35) + (category_overlap * 0.35) + (semantic_overlap * 0.30),
    )

    if confidence >= 0.75:
        return confidence, "Folder intent and content match strongly."
    if confidence >= 0.5:
        return confidence, "Folder appears plausible but the match is weak."
    return confidence, "Folder intent, categories, and content do not align strongly."


def build_note_action_plan_prompt(
    user_prompt: str,
    referenced_notes: list[NoteReference],
) -> str:
    note_context = (
        "\n\n".join(
            f"Referenced note: {note.path}\n---\n{note.content.strip() or '(empty note)'}"
            for note in referenced_notes
        )
        if referenced_notes
        else "No referenced notes were supplied."
    )

    return "\n\n".join(
        [
            "You are planning safe Obsidian vault file actions.",
            "Return strict JSON only. No markdown fences. No commentary.",
            "Only use actions 'create' or 'update'.",
            "Each operation must include a vault-relative markdown path and the full desired file content.",
            (
                'Use this shape: {"summary":"...","requires_confirmation":true,'
                '"operations":[{"action":"create","path":"Folder/Note.md","content":"...","summary":"..."}]}'
            ),
            f"Referenced notes:\n{note_context}",
            f"Requested change:\n{user_prompt.strip()}",
        ]
    )


def parse_note_action_plan_response(raw_text: str) -> NoteActionPlanResponse:
    cleaned_text = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    parsed = json.loads(cleaned_text)
    return NoteActionPlanResponse.model_validate(parsed)


def build_kanban_action_plan_prompt(
    user_prompt: str,
    boards: list[KanbanBoardReference],
) -> str:
    board_context = (
        "\n\n".join(
            f"Kanban board: {board.path}\n---\n{board.content.strip() or '(empty board)'}"
            for board in boards
        )
        if boards
        else "No Kanban boards were supplied."
    )

    return "\n\n".join(
        [
            "You are planning safe Kanban board actions for an Obsidian vault.",
            "Return strict JSON only. No markdown fences. No commentary.",
            "Only use actions 'create_card', 'move_card', or 'update_card'.",
            (
                "Use 'create_card' to add a card to an existing lane, "
                "'move_card' to move a card between existing lanes, and "
                "'update_card' to rename an existing card."
            ),
            "Do not invent board paths or lane names that are not present in the supplied boards.",
            (
                'Use this shape: {"summary":"...","requires_confirmation":true,'
                '"operations":[{"action":"move_card","board_path":"Boards/Project.md",'
                '"source_lane_title":"Backlog","target_lane_title":"Doing",'
                '"card_title":"Draft outline","new_card_title":"","summary":"..."}]}'
            ),
            f"Available Kanban boards:\n{board_context}",
            f"Requested change:\n{user_prompt.strip()}",
        ]
    )


def parse_kanban_action_plan_response(raw_text: str) -> KanbanActionPlanResponse:
    cleaned_text = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    parsed = json.loads(cleaned_text)
    return KanbanActionPlanResponse.model_validate(parsed)


def build_agent_action_plan_prompt(
    user_prompt: str,
    referenced_notes: list[NoteReference],
    boards: list[KanbanBoardReference],
) -> str:
    note_context = (
        "\n\n".join(
            f"Referenced note: {note.path}\n---\n{note.content.strip() or '(empty note)'}"
            for note in referenced_notes
        )
        if referenced_notes
        else "No referenced notes were supplied."
    )
    board_context = (
        "\n\n".join(
            f"Kanban board: {board.path}\n---\n{board.content.strip() or '(empty board)'}"
            for board in boards
        )
        if boards
        else "No Kanban boards were supplied."
    )

    return "\n\n".join(
        [
            "You are planning safe structured actions for an Obsidian vault.",
            "Return strict JSON only. No markdown fences. No commentary.",
            (
                "Allowed action types are: "
                "'note_create', 'note_update', 'kanban_card_create', "
                "'kanban_card_move', and 'kanban_card_update'."
            ),
            "Use note actions for markdown note creation or full-content updates.",
            "Use Kanban actions only for supplied Kanban boards and existing lane names.",
            (
                'Use this shape: {"summary":"...","requires_confirmation":true,'
                '"actions":[{"type":"note_create","path":"Projects/Plan.md","content":"...","summary":"..."},'
                '{"type":"kanban_card_move","board_path":"Boards/Project.md",'
                '"source_lane_title":"Backlog","target_lane_title":"Doing",'
                '"card_title":"Draft outline","new_card_title":"","summary":"..."}]}'
            ),
            f"Referenced notes:\n{note_context}",
            f"Kanban boards:\n{board_context}",
            f"Requested change:\n{user_prompt.strip()}",
        ]
    )


def parse_agent_action_plan_response(raw_text: str) -> AgentActionPlanResponse:
    cleaned_text = (
        raw_text.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    parsed = json.loads(cleaned_text)
    return AgentActionPlanResponse.model_validate(parsed)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    client = get_client()

    with suppress(Exception):
        await run_in_threadpool(client.ps)
        return HealthResponse(
            status="ok",
            ollama_reachable=True,
            database_ready=DB_PATH.exists(),
        )

    return HealthResponse(
        status="degraded",
        ollama_reachable=False,
        database_ready=DB_PATH.exists(),
    )


@app.post("/context/sync", response_model=ContextSyncResponse)
async def context_sync(payload: ContextSyncRequest) -> ContextSyncResponse:
    try:
        await run_in_threadpool(replace_runtime_context, payload.model_dump())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to sync runtime context into SQLite: {exc}",
        ) from exc

    return ContextSyncResponse(
        status="ok",
        database_path=str(DB_PATH),
        note_count=len(payload.note_entries),
        folder_count=len(payload.vault_map.top_folders),
    )


@app.post("/context/index", response_model=ContextIndexResponse)
async def context_index(payload: ContextIndexRequest) -> ContextIndexResponse:
    try:
        existing_categories = await run_in_threadpool(get_existing_ai_category_names)
        if payload.vault_path.strip():
            indexed = await run_in_threadpool(
                index_vault_path,
                payload.vault_path.strip(),
                payload.indexed_at,
                existing_categories,
                payload.model.strip() or None,
            )
        else:
            indexed = await run_in_threadpool(
                index_vault,
                [note.model_dump() for note in payload.note_sources],
                payload.indexed_at,
                existing_categories,
                payload.model.strip() or None,
            )
        await run_in_threadpool(
            replace_runtime_context,
            {
                **indexed,
                "vault_path": payload.vault_path.strip(),
                "model": payload.model.strip(),
                "manual_context_items": payload.manual_context_items,
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to index vault into SQLite: {exc}",
        ) from exc

    return ContextIndexResponse(
        indexed_at=indexed["indexed_at"],
        file_paths=indexed["file_paths"],
        note_entries=[
            SyncNoteEntry.model_validate(item) for item in indexed["note_entries"]
        ],
        vault_summary=indexed["vault_summary"],
        vault_map=SyncVaultMap.model_validate(indexed["vault_map"]),
        database_path=str(DB_PATH),
    )


@app.post("/context/reindex", response_model=ContextReindexResponse)
async def context_reindex(
    payload: ContextReindexRequest,
) -> ContextReindexResponse:
    vault_path = payload.vault_path.strip() or await run_in_threadpool(
        get_last_vault_path
    )
    model = payload.model.strip() or await run_in_threadpool(
        get_metadata,
        "last_index_model",
    )
    if not vault_path:
        raise HTTPException(
            status_code=400,
            detail="No vault path is stored yet. Index once from the plugin first.",
        )

    try:
        indexed_at = time.time_ns() // 1_000_000
        existing_categories = await run_in_threadpool(get_existing_ai_category_names)
        indexed = await run_in_threadpool(
            index_vault_path,
            vault_path,
            indexed_at,
            existing_categories,
            model,
        )
        await run_in_threadpool(
            replace_runtime_context,
            {
                **indexed,
                "vault_path": vault_path,
                "model": model or "",
                "manual_context_items": await run_in_threadpool(get_user_context_items),
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reindex vault from stored path: {exc}",
        ) from exc

    return ContextReindexResponse(
        indexed_at=indexed["indexed_at"],
        file_paths=indexed["file_paths"],
        note_entries=[
            SyncNoteEntry.model_validate(item) for item in indexed["note_entries"]
        ],
        vault_summary=indexed["vault_summary"],
        vault_map=SyncVaultMap.model_validate(indexed["vault_map"]),
        database_path=str(DB_PATH),
        source=vault_path,
    )


@app.post("/context/retrieve", response_model=ContextRetrieveResponse)
async def context_retrieve(
    payload: ContextRetrieveRequest,
) -> ContextRetrieveResponse:
    try:
        paths = await run_in_threadpool(
            retrieve_relevant_note_paths,
            payload.query,
            payload.excluded_paths,
            payload.limit,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve context from SQLite: {exc}",
        ) from exc

    return ContextRetrieveResponse(paths=paths)


@app.get("/context/tables", response_model=ContextTablesResponse)
async def context_tables() -> ContextTablesResponse:
    try:
        snapshot = await run_in_threadpool(get_table_snapshot)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read SQLite tables: {exc}",
        ) from exc

    return ContextTablesResponse(**snapshot)


@app.get("/context/meta", response_model=ContextMetaResponse)
async def context_meta() -> ContextMetaResponse:
    try:
        meta = await run_in_threadpool(get_context_meta)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read runtime context metadata: {exc}",
        ) from exc

    return ContextMetaResponse(**meta)


@app.post("/generate", response_model=GenerateResponse)
async def generate(payload: GenerateRequest) -> GenerateResponse:
    client = get_client()

    try:
        result = await run_in_threadpool(
            client.generate,
            model=payload.model,
            prompt=payload.prompt,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama request failed: {exc}",
        ) from exc

    response_text = result.get("response", "").strip()
    if not response_text:
        raise HTTPException(
            status_code=502,
            detail="Ollama returned an empty response.",
        )

    return GenerateResponse(model=payload.model, response=response_text)


def stream_generate_chunks(model: str, prompt: str):
    client = get_client()

    try:
        for chunk in client.generate(model=model, prompt=prompt, stream=True):
            yield (
                json.dumps(
                    {
                        "model": chunk.get("model", model),
                        "response": chunk.get("response", ""),
                        "done": chunk.get("done", False),
                    }
                )
                + "\n"
            )
    except Exception as exc:
        yield (
            json.dumps(
                {
                    "model": model,
                    "response": "",
                    "done": True,
                    "error": f"Ollama stream failed: {exc}",
                }
            )
            + "\n"
        )


@app.post("/generate-stream")
async def generate_stream(payload: GenerateRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_generate_chunks(payload.model, payload.prompt),
        media_type="application/x-ndjson",
    )


@app.post("/quick-entry", response_model=QuickEntryResponse)
async def quick_entry(payload: QuickEntryRequest) -> QuickEntryResponse:
    client = get_client()
    folder_contexts = await run_in_threadpool(get_folder_contexts)
    existing_categories = await run_in_threadpool(get_existing_ai_category_names)
    inferred_categories = await run_in_threadpool(
        classify_note_categories,
        {
            "path": "Quick Entry.md",
            "markdown": payload.entry_text,
            "tags": [],
            "links": [],
        },
        existing_categories,
        payload.model,
    )
    prompt = build_quick_entry_prompt(
        payload.entry_text,
        payload.existing_folders,
        folder_contexts,
    )

    for _ in range(2):
        try:
            result = await run_in_threadpool(
                client.generate,
                model=payload.model,
                prompt=prompt,
            )
            response_text = result.get("response", "").strip()
            if not response_text:
                raise HTTPException(
                    status_code=502,
                    detail="Ollama returned an empty quick entry response.",
                )
            parsed = parse_quick_entry_response(response_text)
            confidence, reason = compute_quick_entry_confidence(
                parsed.target_folder,
                payload.entry_text,
                inferred_categories,
                folder_contexts,
            )
            final_folder = (
                parsed.target_folder.strip() if confidence >= 0.75 else "Needs Home"
            )
            return QuickEntryResponse(
                note_title=parsed.note_title,
                target_folder=final_folder or "Needs Home",
                note_body=parsed.note_body,
                log_summary=parsed.log_summary,
                tags=parsed.tags,
                inferred_categories=inferred_categories,
                placement_confidence=confidence,
                placement_reason=reason,
            )
        except (json.JSONDecodeError, ValidationError):
            prompt = "\n\n".join(
                [
                    prompt,
                    "Your last answer was invalid.",
                    "Return valid JSON only and match the required shape exactly.",
                ]
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama quick entry request failed: {exc}",
            ) from exc

    raise HTTPException(
        status_code=502,
        detail="Quick entry response could not be validated after retry.",
    )


@app.post("/note-action-plan", response_model=NoteActionPlanResponse)
async def note_action_plan(payload: NoteActionPlanRequest) -> NoteActionPlanResponse:
    client = get_client()
    prompt = build_note_action_plan_prompt(payload.prompt, payload.referenced_notes)

    for _ in range(2):
        try:
            result = await run_in_threadpool(
                client.generate,
                model=payload.model,
                prompt=prompt,
            )
            response_text = result.get("response", "").strip()
            if not response_text:
                raise HTTPException(
                    status_code=502,
                    detail="Ollama returned an empty note action plan response.",
                )
            return parse_note_action_plan_response(response_text)
        except (json.JSONDecodeError, ValidationError):
            prompt = "\n\n".join(
                [
                    prompt,
                    "Your last answer was invalid.",
                    "Return valid JSON only and match the required shape exactly.",
                ]
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama note action plan request failed: {exc}",
            ) from exc

    raise HTTPException(
        status_code=502,
        detail="Note action plan response could not be validated after retry.",
    )


@app.post("/kanban-action-plan", response_model=KanbanActionPlanResponse)
async def kanban_action_plan(
    payload: KanbanActionPlanRequest,
) -> KanbanActionPlanResponse:
    client = get_client()
    prompt = build_kanban_action_plan_prompt(payload.prompt, payload.boards)

    for _ in range(2):
        try:
            result = await run_in_threadpool(
                client.generate,
                model=payload.model,
                prompt=prompt,
            )
            response_text = result.get("response", "").strip()
            if not response_text:
                raise HTTPException(
                    status_code=502,
                    detail="Ollama returned an empty Kanban action plan response.",
                )
            return parse_kanban_action_plan_response(response_text)
        except (json.JSONDecodeError, ValidationError):
            prompt = "\n\n".join(
                [
                    prompt,
                    "Your last answer was invalid.",
                    "Return valid JSON only and match the required shape exactly.",
                ]
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama Kanban action plan request failed: {exc}",
            ) from exc

    raise HTTPException(
        status_code=502,
        detail="Kanban action plan response could not be validated after retry.",
    )


@app.post("/agent-action-plan", response_model=AgentActionPlanResponse)
async def agent_action_plan(
    payload: AgentActionPlanRequest,
) -> AgentActionPlanResponse:
    client = get_client()
    prompt = build_agent_action_plan_prompt(
        payload.prompt,
        payload.referenced_notes,
        payload.boards,
    )

    for _ in range(2):
        try:
            result = await run_in_threadpool(
                client.generate,
                model=payload.model,
                prompt=prompt,
            )
            response_text = result.get("response", "").strip()
            if not response_text:
                raise HTTPException(
                    status_code=502,
                    detail="Ollama returned an empty agent action plan response.",
                )
            return parse_agent_action_plan_response(response_text)
        except (json.JSONDecodeError, ValidationError):
            prompt = "\n\n".join(
                [
                    prompt,
                    "Your last answer was invalid.",
                    "Return valid JSON only and match the required shape exactly.",
                ]
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama agent action plan request failed: {exc}",
            ) from exc

    raise HTTPException(
        status_code=502,
        detail="Agent action plan response could not be validated after retry.",
    )
