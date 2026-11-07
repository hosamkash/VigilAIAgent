import { useMemo, useState } from "react";
import {
  branchColor,
  filterGraphNodes,
  type GitGraphNode,
  type ParsedGitGraph,
} from "../../../lib/git-graph";

const ROW_H = 22;
const LANE_W = 14;
const DOT_R = 4;
const LEFT_PAD = 8;

export function GitGraphView({
  graph,
  currentBranch,
  onSelectCommit,
  onCheckout,
  onCreateBranch,
  onCherryPick,
}: {
  graph: ParsedGitGraph | null;
  currentBranch: string;
  onSelectCommit: (node: GitGraphNode) => void;
  onCheckout: (node: GitGraphNode) => void;
  onCreateBranch: (node: GitGraphNode) => void;
  onCherryPick: (node: GitGraphNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(
    () => (graph ? filterGraphNodes(graph.nodes, query) : []),
    [graph, query],
  );
  const selectedNode = nodes.find((node) => node.hash === selected) ?? null;

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="px-2 py-3 text-[11px] text-[var(--vigil-muted)]">
        No commits to graph yet.
      </div>
    );
  }

  const lanes = Math.max(graph.maxLanes, 1);
  const graphW = LEFT_PAD + lanes * LANE_W + 8;
  const height = nodes.length * ROW_H + 8;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search commits…"
        className="mb-1 rounded border border-[var(--vigil-border)] bg-[var(--vigil-input)] px-2 py-1 text-[11px]"
      />
      {selectedNode && (
        <div className="mb-1 flex flex-wrap gap-1">
          <GraphAction onClick={() => onSelectCommit(selectedNode)}>Show</GraphAction>
          <GraphAction onClick={() => onCheckout(selectedNode)}>Checkout</GraphAction>
          <GraphAction onClick={() => onCreateBranch(selectedNode)}>
            Branch
          </GraphAction>
          <GraphAction onClick={() => onCherryPick(selectedNode)}>
            Cherry-pick
          </GraphAction>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ minHeight: height }}>
          <svg
            width={graphW}
            height={height}
            className="pointer-events-none absolute left-0 top-0"
            aria-hidden
          >
            {nodes.map((n, i) => {
              const y = i * ROW_H + ROW_H / 2;
              const x = LEFT_PAD + n.lane * LANE_W;
              const color = branchColor(n.colorIndex);
              const next = nodes[i + 1];
              return (
                <g key={`${n.hash}-${i}`}>
                  {next && (
                    <line
                      x1={x}
                      y1={y}
                      x2={LEFT_PAD + next.lane * LANE_W}
                      y2={y + ROW_H}
                      stroke={branchColor(Math.min(n.colorIndex, next.colorIndex))}
                      strokeWidth={1.5}
                      opacity={0.55}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={n.isHead || n.refs.some((r) => r.includes(currentBranch)) ? DOT_R + 1 : DOT_R}
                    fill={color}
                    stroke={
                      selected === n.hash
                        ? "var(--vigil-text)"
                        : n.isHead
                          ? "var(--vigil-accent)"
                          : "transparent"
                    }
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}
          </svg>
          <div style={{ paddingLeft: graphW }}>
            {nodes.map((n, i) => {
              const highlight =
                n.isHead ||
                n.refs.some(
                  (r) =>
                    r === currentBranch ||
                    r.endsWith(` ${currentBranch}`) ||
                    r.includes(`-> ${currentBranch}`),
                );
              return (
                <button
                  key={`${n.hash}-row-${i}`}
                  type="button"
                  className={`flex h-[22px] w-full items-center gap-1 truncate px-1 text-left text-[11px] hover:bg-[var(--vigil-hover)] ${
                    selected === n.hash ? "bg-[var(--vigil-selection)]" : ""
                  } ${highlight ? "font-medium" : ""}`}
                  onClick={() => {
                    setSelected(n.hash);
                    onSelectCommit(n);
                  }}
                  title={n.message}
                >
                  <span className="shrink-0 font-mono text-[10px] text-[var(--vigil-accent)]">
                    {n.shortHash}
                  </span>
                  {n.refs.length > 0 && (
                    <span className="shrink-0 truncate text-[9px] text-[var(--vigil-success)]">
                      {n.refs.slice(0, 2).join(", ")}
                    </span>
                  )}
                  <span className="min-w-0 truncate text-[var(--vigil-text)]">
                    {n.message}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function GraphAction({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded border border-[var(--vigil-border)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--vigil-hover)]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
