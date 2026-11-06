/**
 * Parse `git log --graph --oneline --decorate --all` into drawable nodes.
 */

export interface GitGraphNode {
  hash: string;
  shortHash: string;
  message: string;
  refs: string[];
  /** ASCII graph prefix before the hash (e.g. "* | \\") */
  graph: string;
  /** Lane index of the commit bullet (0-based) */
  lane: number;
  /** Color index for the lane */
  colorIndex: number;
  isHead: boolean;
}

export interface ParsedGitGraph {
  nodes: GitGraphNode[];
  maxLanes: number;
}

const COMMIT_RE =
  /^(?<graph>[\s*|/\\]+)\s*(?<hash>[0-9a-f]{7,40})(?<decorate>\s+\((?<refs>[^)]+)\))?\s*(?<msg>.*)$/i;

const BRANCH_COLORS = [
  "#0078d4",
  "#388a34",
  "#c72e0f",
  "#8764b8",
  "#ca5010",
  "#038387",
  "#881798",
  "#004e8c",
];

export function branchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length]!;
}

export function parseGitGraphLog(raw: string): ParsedGitGraph {
  const nodes: GitGraphNode[] = [];
  let maxLanes = 1;

  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.trim()) continue;
    const m = COMMIT_RE.exec(trimmed);
    if (!m?.groups) continue;

    const graph = m.groups.graph ?? "";
    const hash = m.groups.hash ?? "";
    const refsRaw = m.groups.refs ?? "";
    const message = (m.groups.msg ?? "").trim();
    const refs = refsRaw
      ? refsRaw.split(",").map((r) => r.trim()).filter(Boolean)
      : [];

    let lane = 0;
    for (let i = 0; i < graph.length; i++) {
      if (graph[i] === "*") {
        lane = Math.floor(i / 2);
        break;
      }
    }
    maxLanes = Math.max(maxLanes, lane + 1);

    const isHead = refs.some(
      (r) => r === "HEAD" || r.startsWith("HEAD ->") || r.includes("HEAD ->"),
    );

    nodes.push({
      hash,
      shortHash: hash.slice(0, 7),
      message,
      refs,
      graph,
      lane,
      colorIndex: lane,
      isHead,
    });
  }

  return { nodes, maxLanes };
}

export function filterGraphNodes(
  nodes: GitGraphNode[],
  query: string,
): GitGraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return nodes.filter(
    (n) =>
      n.message.toLowerCase().includes(q) ||
      n.hash.toLowerCase().includes(q) ||
      n.refs.some((r) => r.toLowerCase().includes(q)),
  );
}
