# Codex Prompt — Obsidian AI Runtime (Structured Vault System v2)

## 🎯 Core Intent

Build a local-first AI runtime integrated with Obsidian + Ollama that uses structured SQL context instead of raw text.

---

## 🧠 Category System Fix (CRITICAL UPDATE)

### Problem
AI is incorrectly generating categories based on tokens (e.g. hex codes, variables).

### Goal
Force AI to perform semantic classification, not keyword extraction.

---

## 🧠 AI CATEGORY GENERATION RULES

When generating categories, you MUST follow these rules:

1. Categories must represent the OVERALL THEME of the note  
2. Categories must be reusable across multiple notes  
3. Categories must be 1–3 items only  

### Good Examples
- printer  
- job-hunting  
- web-development  

### Bad Examples
- #0B0F14  
- variable_name  
- function  
- random keywords  

---

## NEVER CREATE CATEGORIES FROM:
- hex codes  
- numbers  
- IDs  
- variable names  
- filenames  

---

## CATEGORY MATCHING RULES

Before creating a category:

1. Check existing categories  
2. If similar → reuse existing  
3. Only create new if no match exists  

Normalize:
- lowercase  
- singular form  
- use hyphenated phrases when needed  

---

## CATEGORY COUNTING (IMPORTANCE)

Each category must track usage count.

Logic:
- If category exists → increment count  
- If new → create with count = 1  

---

## Updated Schema (Categories Table)

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    summary TEXT,
    source TEXT CHECK(source IN ('ai', 'user')) NOT NULL,
    related_notes TEXT,
    count INTEGER DEFAULT 1
);

---

## CATEGORY GENERATION PROMPT

Use this during indexing:

You are classifying an Obsidian note into high-level categories.

Rules:
- Output 1–3 categories
- Categories must describe the overall topic
- Do NOT extract keywords
- Do NOT include raw values (hex, numbers, IDs)
- Prefer existing categories if similar

Existing categories:
{existing_categories}

These existing categories come from the runtime SQLite `categories` table.
Reuse them whenever they are a semantic match rather than inventing a near-duplicate.

Note content:
{note_content}

Return ONLY a JSON array of category names.

---

## FINAL GOAL

The AI should:
- behave like a classifier
- produce stable, reusable categories
- avoid noisy or useless categories
- improve vault structure over time

The runtime will persist these categories into SQLite and track per-category note membership and usage counts.
