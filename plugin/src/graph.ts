export interface GraphNoteSummary {
  outgoing_links: string[];
  incoming_links: string[];
  tags: string[];
  graph_role: "hub" | "connected" | "leaf" | "isolated";
}

function get_graph_role(
  summary: GraphNoteSummary,
): GraphNoteSummary["graph_role"] {
  const incoming_count = summary.incoming_links.length;
  const outgoing_count = summary.outgoing_links.length;

  if (incoming_count + outgoing_count === 0) {
    return "isolated";
  }

  if (incoming_count >= 3 || outgoing_count >= 3) {
    return "hub";
  }

  if (incoming_count > 0 && outgoing_count > 0) {
    return "connected";
  }

  return "leaf";
}

export function build_graph_summary(args: {
  outgoing_links: string[];
  incoming_links: string[];
  tags: string[];
}): GraphNoteSummary {
  const summary: GraphNoteSummary = {
    outgoing_links: args.outgoing_links.slice(0, 8),
    incoming_links: args.incoming_links.slice(0, 8),
    tags: args.tags.slice(0, 12),
    graph_role: "isolated",
  };
  summary.graph_role = get_graph_role(summary);
  return summary;
}

export function build_graph_context(
  path: string,
  markdown: string,
  summary: GraphNoteSummary,
): string {
  const outgoing_lines = summary.outgoing_links.length
    ? summary.outgoing_links.map((link) => `  - ${link}`).join("\n")
    : "  - (none)";
  const incoming_lines = summary.incoming_links.length
    ? summary.incoming_links.map((link) => `  - ${link}`).join("\n")
    : "  - (none)";
  const tag_lines = summary.tags.length
    ? summary.tags.map((tag) => `  - ${tag}`).join("\n")
    : "  - (none)";

  return [
    markdown.trim(),
    "",
    `Structured graph summary for ${path}:`,
    `Graph role: ${summary.graph_role}`,
    "Outgoing links:",
    outgoing_lines,
    "Incoming links:",
    incoming_lines,
    "Tags:",
    tag_lines,
  ].join("\n");
}
