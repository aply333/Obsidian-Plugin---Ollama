import type { KanbanActionOperation } from "./chat";

export interface KanbanCard {
  title: string;
  line_index: number;
}

export interface KanbanLane {
  title: string;
  heading_line_index: number;
  end_line_index: number;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  lanes: KanbanLane[];
  lines: string[];
}

function readFrontmatterValue(markdown: string, key: string): string | null {
  const frontmatter_match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter_match) {
    return null;
  }

  const line = frontmatter_match[1]
    .split("\n")
    .find((entry) => entry.trim().startsWith(`${key}:`));

  if (!line) {
    return null;
  }

  return line.split(":").slice(1).join(":").trim();
}

export function is_kanban_note(markdown: string): boolean {
  return readFrontmatterValue(markdown, "kanban-plugin") === "board";
}

export function parse_kanban_board(markdown: string): KanbanBoard | null {
  if (!is_kanban_note(markdown)) {
    return null;
  }

  const lines = markdown.split("\n");
  const lanes: KanbanLane[] = [];
  let current_lane: KanbanLane | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("## ")) {
      if (current_lane) {
        current_lane.end_line_index = index;
      }

      current_lane = {
        title: line.replace(/^##\s+/, "").trim(),
        heading_line_index: index,
        end_line_index: lines.length,
        cards: [],
      };
      lanes.push(current_lane);
      continue;
    }

    if (!current_lane) {
      continue;
    }

    const card_match = line.match(/^[-*]\s+(?:\[[^\]]*\]\s+)?(.+)$/);
    if (card_match) {
      current_lane.cards.push({
        title: card_match[1].trim(),
        line_index: index,
      });
    }
  }

  return { lanes, lines };
}

function find_lane(board: KanbanBoard, title: string): KanbanLane {
  const lane = board.lanes.find((entry) => entry.title === title);
  if (!lane) {
    throw new Error(`Kanban lane not found: ${title}`);
  }
  return lane;
}

function find_unique_card(lane: KanbanLane, title: string): KanbanCard {
  const matches = lane.cards.filter((card) => card.title === title);
  if (!matches.length) {
    throw new Error(`Kanban card not found in lane '${lane.title}': ${title}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Kanban card title is ambiguous in lane '${lane.title}': ${title}`,
    );
  }
  return matches[0];
}

function find_insert_index(board: KanbanBoard, lane: KanbanLane): number {
  if (lane.cards.length) {
    return lane.cards[lane.cards.length - 1].line_index + 1;
  }

  let index = lane.heading_line_index + 1;
  while (index < lane.end_line_index && !board.lines[index].trim()) {
    index += 1;
  }
  return index;
}

function splice_line(lines: string[], index: number, value: string): string[] {
  const next = [...lines];
  next.splice(index, 0, value);
  return next;
}

function replace_line(lines: string[], index: number, value: string): string[] {
  const next = [...lines];
  next[index] = value;
  return next;
}

function remove_line(lines: string[], index: number): string[] {
  const next = [...lines];
  next.splice(index, 1);
  return next;
}

export function apply_kanban_operation(
  markdown: string,
  operation: KanbanActionOperation,
): string {
  const board = parse_kanban_board(markdown);
  if (!board) {
    throw new Error(
      `Target note is not a Kanban board: ${operation.board_path}`,
    );
  }

  if (operation.action === "create_card") {
    const target_lane = find_lane(board, operation.target_lane_title);
    const insert_index = find_insert_index(board, target_lane);
    return splice_line(
      board.lines,
      insert_index,
      `- ${operation.card_title}`,
    ).join("\n");
  }

  if (operation.action === "update_card") {
    const source_lane = find_lane(board, operation.source_lane_title);
    const card = find_unique_card(source_lane, operation.card_title);
    const existing_line = board.lines[card.line_index];
    const updated_line = existing_line.replace(
      /(^[-*]\s+(?:\[[^\]]*\]\s+)?).+$/,
      `$1${operation.new_card_title}`,
    );
    return replace_line(board.lines, card.line_index, updated_line).join("\n");
  }

  const source_lane = find_lane(board, operation.source_lane_title);
  const card = find_unique_card(source_lane, operation.card_title);
  const card_line = board.lines[card.line_index];
  const without_card = remove_line(board.lines, card.line_index).join("\n");
  const next_board = parse_kanban_board(without_card);
  if (!next_board) {
    throw new Error(
      `Target note is not a Kanban board: ${operation.board_path}`,
    );
  }

  const target_lane = find_lane(next_board, operation.target_lane_title);
  const insert_index = find_insert_index(next_board, target_lane);
  return splice_line(next_board.lines, insert_index, card_line).join("\n");
}

export function build_kanban_context(path: string, markdown: string): string {
  const board = parse_kanban_board(markdown);
  if (!board) {
    return markdown;
  }

  const lane_lines = board.lanes.map((lane) => {
    const cards = lane.cards.length
      ? lane.cards.map((card) => `  - ${card.title}`).join("\n")
      : "  - (empty)";
    return `${lane.title}\n${cards}`;
  });

  return [
    markdown.trim(),
    "",
    `Structured Kanban summary for ${path}:`,
    lane_lines.join("\n"),
  ].join("\n");
}
