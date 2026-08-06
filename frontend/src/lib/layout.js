// Auto-layout helpers. Deliberately dependency-free: the graphs here are small
// (hundreds of nodes at most), so a layered BFS pass is both fast and predictable.

const COL_GAP = 340; // node width is 240px + breathing room
const ROW_GAP = 190;
const COMPONENT_GAP = 90;

function buildAdjacency(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map();
  const inDeg = new Map();
  const undirected = new Map();
  nodes.forEach((n) => {
    out.set(n.id, []);
    undirected.set(n.id, []);
    inDeg.set(n.id, 0);
  });
  edges.forEach((e) => {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) return;
    out.get(e.source).push(e.target);
    inDeg.set(e.target, inDeg.get(e.target) + 1);
    undirected.get(e.source).push(e.target);
    undirected.get(e.target).push(e.source);
  });
  return { out, inDeg, undirected };
}

function components(nodes, undirected) {
  const seen = new Set();
  const result = [];
  nodes.forEach((n) => {
    if (seen.has(n.id)) return;
    const group = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      (undirected.get(cur) || []).forEach((nb) => {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      });
    }
    result.push(group);
  });
  return result;
}

/**
 * Left-to-right layered layout: sources on the left, everything they point to
 * to the right of them. Disconnected clusters are stacked vertically.
 * @returns {Array<{id: string, position: {x: number, y: number}}>}
 */
export function layeredLayout(nodes, edges) {
  if (!nodes.length) return [];
  const { out, inDeg, undirected } = buildAdjacency(nodes, edges);
  const positions = [];
  let yOffset = 0;

  for (const group of components(nodes, undirected)) {
    const groupSet = new Set(group);
    // Roots: nodes nothing points at. A pure cycle has none — fall back to the
    // best-connected node so the component still gets laid out.
    let roots = group.filter((id) => inDeg.get(id) === 0);
    if (!roots.length) {
      roots = [group.slice().sort((a, b) =>
        (undirected.get(b).length - undirected.get(a).length))[0]];
    }

    const depth = new Map();
    const queue = [];
    roots.forEach((id) => { depth.set(id, 0); queue.push(id); });
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const d = depth.get(cur);
      for (const nb of out.get(cur) || []) {
        if (!groupSet.has(nb)) continue;
        // Longest-path depth keeps arrows pointing forward.
        if (!depth.has(nb) || depth.get(nb) < d + 1) {
          depth.set(nb, d + 1);
          queue.push(nb);
        }
      }
      if (queue.length > group.length * 8) break; // cycle guard
    }
    // Anything unreachable (reverse-only links) lands in its own trailing column.
    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    group.forEach((id) => { if (!depth.has(id)) depth.set(id, maxDepth + 1); });

    const columns = new Map();
    group.forEach((id) => {
      const d = depth.get(id);
      if (!columns.has(d)) columns.set(d, []);
      columns.get(d).push(id);
    });

    const tallest = Math.max(...Array.from(columns.values(), (c) => c.length));
    for (const [d, ids] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
      // Centre each column against the tallest one — reads much tidier.
      const startY = ((tallest - ids.length) * ROW_GAP) / 2;
      ids.forEach((id, i) => {
        positions.push({ id, position: { x: d * COL_GAP, y: yOffset + startY + i * ROW_GAP } });
      });
    }
    yOffset += tallest * ROW_GAP + COMPONENT_GAP;
  }
  return positions;
}

/** Plain grid — handy when a graph has few links and layers look arbitrary. */
export function gridLayout(nodes, columns = 4) {
  return nodes.map((n, i) => ({
    id: n.id,
    position: { x: (i % columns) * COL_GAP, y: Math.floor(i / columns) * ROW_GAP },
  }));
}

/** Circle — good for "who is connected to whom" overviews. */
export function circleLayout(nodes) {
  const r = Math.max(260, (nodes.length * 130) / (2 * Math.PI));
  return nodes.map((n, i) => {
    const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    return { id: n.id, position: { x: Math.round(r + r * Math.cos(a)), y: Math.round(r + r * Math.sin(a)) } };
  });
}

export const LAYOUTS = [
  { id: "layered", labelKey: "layouts.layered", run: layeredLayout },
  { id: "grid", labelKey: "layouts.grid", run: (nodes) => gridLayout(nodes) },
  { id: "circle", labelKey: "layouts.circle", run: (nodes) => circleLayout(nodes) },
];
