export interface VaultNoteIndexEntry {
  path: string;
  title: string;
  excerpt: string;
  tags: string[];
  links: string[];
  ai_categories?: string[];
  word_count: number;
}

export interface VaultMapFolderEntry {
  folder: string;
  note_count: number;
  sample_titles: string[];
  sample_paths: string[];
  top_topics: string[];
  intent?: string;
}

export interface VaultMapTagEntry {
  tag: string;
  count: number;
}

export interface VaultMapLinkEntry {
  note_path: string;
  title: string;
  link_count: number;
}

export interface VaultMapEntityEntry {
  token: string;
  count: number;
}

export interface VaultMapState {
  generated_at: number;
  note_count: number;
  dominant_topics: string[];
  top_folders: VaultMapFolderEntry[];
  top_tags: VaultMapTagEntry[];
  most_connected_notes: VaultMapLinkEntry[];
  representative_notes: Array<{ path: string; title: string }>;
}

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "can",
  "at",
  "be",
  "describe",
  "by",
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
  "that",
  "tell",
  "the",
  "this",
  "through",
  "to",
  "vault",
  "what",
  "with",
  "you",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function getFolderPath(path: string): string {
  return path.includes("/") ? path.split("/").slice(0, -1).join("/") : "(root)";
}

function isVaultOverviewQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  const phrases = [
    "tell me about this vault",
    "what can you tell me about this vault",
    "summarize this vault",
    "summarise this vault",
    "overview of this vault",
    "what is in this vault",
    "describe this vault",
  ];

  return (
    phrases.some((phrase) => normalized.includes(phrase)) ||
    (normalized.includes("vault") &&
      (normalized.includes("summary") ||
        normalized.includes("summarize") ||
        normalized.includes("summarise") ||
        normalized.includes("overview") ||
        normalized.includes("describe") ||
        normalized.includes("tell me about")))
  );
}

function getRepresentativePaths(
  entries: VaultNoteIndexEntry[],
  excluded: Set<string>,
  limit: number,
): string[] {
  const byFolder = new Map<string, VaultNoteIndexEntry[]>();

  for (const entry of entries) {
    if (excluded.has(entry.path)) {
      continue;
    }

    const folder = getFolderPath(entry.path);
    const folderEntries = byFolder.get(folder) ?? [];
    folderEntries.push(entry);
    byFolder.set(folder, folderEntries);
  }

  const selected: string[] = [];
  const topFolders = [...byFolder.entries()]
    .sort(
      (left, right) =>
        right[1].length - left[1].length || left[0].localeCompare(right[0]),
    )
    .slice(0, Math.max(limit, 6));

  for (const [, folderEntries] of topFolders) {
    const bestEntry = folderEntries
      .slice()
      .sort((left, right) => right.word_count - left.word_count)[0];
    if (bestEntry && !selected.includes(bestEntry.path)) {
      selected.push(bestEntry.path);
    }
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of entries
    .filter((candidate) => !excluded.has(candidate.path))
    .slice()
    .sort((left, right) => right.word_count - left.word_count)) {
    if (!selected.includes(entry.path)) {
      selected.push(entry.path);
    }
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function getTopTopics(entries: VaultNoteIndexEntry[], limit: number): string[] {
  const topicCounts = new Map<string, number>();

  for (const entry of entries) {
    const topicSource = [
      entry.title,
      entry.excerpt,
      entry.tags.join(" "),
      getFolderPath(entry.path),
    ].join(" ");

    for (const token of new Set(tokenize(topicSource))) {
      topicCounts.set(token, (topicCounts.get(token) ?? 0) + 1);
    }
  }

  return [...topicCounts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, limit)
    .map(([token]) => token);
}

function getTopTopicPairs(
  entries: VaultNoteIndexEntry[],
  limit: number,
): Array<{ token: string; count: number }> {
  const topicCounts = new Map<string, number>();

  for (const entry of entries) {
    const topicSource = [
      entry.title,
      entry.excerpt,
      entry.tags.join(" "),
      getFolderPath(entry.path),
    ].join(" ");

    for (const token of new Set(tokenize(topicSource))) {
      topicCounts.set(token, (topicCounts.get(token) ?? 0) + 1);
    }
  }

  return [...topicCounts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, limit)
    .map(([token, count]) => ({ token, count }));
}

export function build_note_index_entry(args: {
  path: string;
  markdown: string;
  tags: string[];
  links: string[];
}): VaultNoteIndexEntry {
  const lines = args.markdown
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title =
    lines
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s+/, "")
      .trim() ||
    args.path.split("/").pop()?.replace(/\.md$/i, "") ||
    args.path;
  const excerpt = lines
    .filter((line) => !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 280);
  const word_count = args.markdown.split(/\s+/).filter(Boolean).length;

  return {
    path: args.path,
    title,
    excerpt,
    tags: [...new Set(args.tags)].sort((left, right) =>
      left.localeCompare(right),
    ),
    links: [...new Set(args.links)].sort((left, right) =>
      left.localeCompare(right),
    ),
    word_count,
  };
}

export function build_vault_summary(args: {
  entries: VaultNoteIndexEntry[];
  file_paths: string[];
}): string {
  const folder_counts = new Map<string, number>();
  const tag_counts = new Map<string, number>();

  for (const path of args.file_paths) {
    const folder = getFolderPath(path);
    folder_counts.set(folder, (folder_counts.get(folder) ?? 0) + 1);
  }

  for (const entry of args.entries) {
    for (const tag of entry.tags) {
      tag_counts.set(tag, (tag_counts.get(tag) ?? 0) + 1);
    }
  }

  const top_folders = [...folder_counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 5)
    .map(([folder, count]) => `- ${folder}: ${count} notes`)
    .join("\n");
  const top_tags = [...tag_counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 8)
    .map(([tag, count]) => `- ${tag}: ${count}`)
    .join("\n");
  const top_topics = getTopTopics(args.entries, 8);
  const sample_notes = getRepresentativePaths(args.entries, new Set(), 5)
    .map((path) => args.entries.find((entry) => entry.path === path))
    .filter((entry): entry is VaultNoteIndexEntry => Boolean(entry))
    .map((entry) => `- ${entry.path}: ${entry.title}`)
    .join("\n");
  const topical_summary = top_topics.length
    ? `Vault themes: ${top_topics.join(", ")}.`
    : "Vault themes: unavailable.";

  return [
    `Vault note count: ${args.file_paths.length}`,
    topical_summary,
    "Top folders:",
    top_folders || "- (none)",
    "Top tags:",
    top_tags || "- (none)",
    "Representative notes:",
    sample_notes || "- (none)",
  ].join("\n");
}

export function build_vault_map(args: {
  entries: VaultNoteIndexEntry[];
  file_paths: string[];
}): VaultMapState {
  const folderEntryMap = new Map<string, VaultNoteIndexEntry[]>();
  const tagCounts = new Map<string, number>();

  for (const entry of args.entries) {
    const folder = getFolderPath(entry.path);
    const bucket = folderEntryMap.get(folder) ?? [];
    bucket.push(entry);
    folderEntryMap.set(folder, bucket);

    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const topFolders = [...folderEntryMap.entries()]
    .sort(
      (left, right) =>
        right[1].length - left[1].length || left[0].localeCompare(right[0]),
    )
    .slice(0, 8)
    .map(([folder, entries]) => {
      const sortedEntries = entries
        .slice()
        .sort((left, right) => right.word_count - left.word_count);
      const folderTopics = getTopTopicPairs(entries, 5).map(
        (entry) => entry.token,
      );

      return {
        folder,
        note_count: entries.length,
        sample_titles: sortedEntries.slice(0, 3).map((entry) => entry.title),
        sample_paths: sortedEntries.slice(0, 3).map((entry) => entry.path),
        top_topics: folderTopics,
      };
    });

  const topTags = [...tagCounts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));

  const mostConnectedNotes = args.entries
    .slice()
    .sort(
      (left, right) =>
        right.links.length - left.links.length ||
        right.word_count - left.word_count,
    )
    .slice(0, 8)
    .map((entry) => ({
      note_path: entry.path,
      title: entry.title,
      link_count: entry.links.length,
    }));

  const representativeNotes = getRepresentativePaths(args.entries, new Set(), 8)
    .map((path) => args.entries.find((entry) => entry.path === path))
    .filter((entry): entry is VaultNoteIndexEntry => Boolean(entry))
    .map((entry) => ({ path: entry.path, title: entry.title }));

  return {
    generated_at: Date.now(),
    note_count: args.file_paths.length,
    dominant_topics: getTopTopicPairs(args.entries, 12).map(
      (entry) => entry.token,
    ),
    top_folders: topFolders,
    top_tags: topTags,
    most_connected_notes: mostConnectedNotes,
    representative_notes: representativeNotes,
  };
}

export function retrieve_relevant_note_paths(args: {
  query: string;
  entries: VaultNoteIndexEntry[];
  excluded_paths?: string[];
  limit?: number;
}): string[] {
  const limit = args.limit ?? 4;
  const excluded = new Set(args.excluded_paths ?? []);
  const query_tokens = tokenize(args.query);

  if (isVaultOverviewQuery(args.query)) {
    return getRepresentativePaths(args.entries, excluded, Math.max(limit, 6));
  }

  const scored = args.entries
    .filter((entry) => !excluded.has(entry.path))
    .map((entry) => {
      const haystack = [
        entry.path,
        entry.title,
        entry.excerpt,
        entry.tags.join(" "),
        (entry.ai_categories ?? []).join(" "),
        entry.links.join(" "),
      ]
        .join(" \n ")
        .toLowerCase();

      let score = 0;
      for (const token of query_tokens) {
        if (entry.title.toLowerCase().includes(token)) {
          score += 8;
        }
        if (entry.path.toLowerCase().includes(token)) {
          score += 6;
        }
        if (entry.tags.some((tag) => tag.toLowerCase().includes(token))) {
          score += 5;
        }
        if (
          (entry.ai_categories ?? []).some((category) =>
            category.toLowerCase().includes(token),
          )
        ) {
          score += 5;
        }
        if (entry.links.some((link) => link.toLowerCase().includes(token))) {
          score += 3;
        }
        if (haystack.includes(token)) {
          score += 2;
        }
      }

      return { path: entry.path, score, word_count: entry.word_count };
    })
    .sort(
      (left, right) =>
        right.score - left.score || right.word_count - left.word_count,
    );

  if (!query_tokens.length || !scored.some((entry) => entry.score > 0)) {
    return getRepresentativePaths(args.entries, excluded, Math.min(limit, 4));
  }

  return scored
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => entry.path);
}
