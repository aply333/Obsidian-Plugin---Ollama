# Codex Prompt — Modification Mode (Obsidian AI Runtime)

## 🚨 IMPORTANT CONTEXT

You are working on an EXISTING system.

DO NOT:
- rebuild the system
- redesign architecture
- replace working components

YOU MUST:
- modify behavior only
- extend existing logic
- preserve current structure

---

## 🎯 OBJECTIVE

Improve system reliability in the following areas:

- Quick Entry placement accuracy
- Category generation quality
- Folder intent awareness
- Chat → action execution
- UI organization

All changes must be incremental and non-breaking.

---

## 🔧 1. Quick Entry Placement (MODIFY ONLY)

Current issue:
- placement is inconsistent / incorrect

### Required changes:

Add placement confidence logic WITHOUT rewriting system.

Rules:

- compute `placement_confidence` (0–1)
- use:
  - folder intent
  - categories
  - semantic similarity

IF:
- confidence >= 0.75 → keep existing placement logic
- confidence < 0.75 → override and place in "Needs Home"

Constraints:
- DO NOT remove current placement logic
- wrap or extend it

---

## 🧠 2. Category System (FIX EXISTING LOGIC)

Current issue:
- categories generated from tokens (hex, variables)

### Modify generation logic:

Enforce:

- categories must describe overall theme
- 1–3 categories max
- must be reusable

NEVER allow:
- hex values
- IDs
- variable names
- raw tokens

### Matching behavior:

- check existing categories FIRST
- reuse if similar
- only create new if necessary

### Counting:

- increment count on reuse
- DO NOT reset existing counts

---

## 📂 3. Intent System (EXTEND INDEXER)

Add support for folder intent WITHOUT breaking indexer.

### Modify indexer:

For folders only:

IF intent exists:
- read and store

IF missing:
- create intent file
- mark for user input

### Data handling:

- store intent in existing table
- DO NOT change table structure drastically

### Placement update:

- prioritize intent over name matching

---

## ⚙️ 4. Chat Execution (CRITICAL FIX)

Current issue:
- AI explains but does not execute

### Modify response behavior:

When edits are requested:

Return structured action:

{
  "action": "...",
  "target_path": "...",
  "changes": "...",
  "requires_confirmation": true
}

Constraints:

- DO NOT remove existing response text
- ADD structured output alongside it

---

## 🔐 5. Confirmation Behavior

Modify execution flow:

- Chat → require ONE confirmation per request
- Quick Entry → no confirmation

Constraints:
- do not add multiple dialogs
- do not block non-edit responses

---

## 🧩 6. UI Adjustments (NON-DESTRUCTIVE)

Make the following changes WITHOUT restructuring UI system:

- remove "Tell me about this vault"
- group tools under "Management Tools"

Move existing:
- model override
- index now
- refresh runtime

Remove duplicate reindex button

---

## 👁 7. Intent File Visibility

Modify file visibility rules:

- hide intent files by default
- exclude from graph

Add toggle:
"Show Intent Files"

Constraints:
- do not alter core file system behavior
- use filtering, not deletion

---

## ⚠️ CODING RULES

- DO NOT rewrite modules unnecessarily
- DO NOT change function signatures unless required
- DO NOT introduce breaking changes
- PREFER wrapping/extending existing logic

---

## ✅ SUCCESS CRITERIA

- placement becomes predictable
- categories become stable and reusable
- AI executes actions instead of describing them
- UI becomes cleaner without regressions

---

## 🧠 FINAL NOTE

You are not building a new system.

You are improving an existing one.

Every change should feel like a patch, not a rewrite.
