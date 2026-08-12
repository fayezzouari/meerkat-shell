// Pure, non-mutating operations over a tab's binary split layout tree:
//   leaf   { type: "leaf", id, session, paneEl }
//   split  { type: "split", dir: "row" | "column", a, b, fraction }

export function eachLeaf(node, fn) {
  if (!node) return;
  if (node.type === "leaf") {
    fn(node);
    return;
  }
  eachLeaf(node.a, fn);
  eachLeaf(node.b, fn);
}

export function leavesOf(node) {
  const out = [];
  eachLeaf(node, (leaf) => out.push(leaf));
  return out;
}

export function findLeaf(node, id) {
  let found = null;
  eachLeaf(node, (leaf) => {
    if (leaf.id === id) found = leaf;
  });
  return found;
}

export function replaceLeaf(node, id, replacement) {
  if (!node) return node;
  if (node.type === "leaf") return node.id === id ? replacement : node;
  return {
    ...node,
    a: replaceLeaf(node.a, id, replacement),
    b: replaceLeaf(node.b, id, replacement),
  };
}

// A split that loses one side collapses into the survivor, rather than
// lingering as an invisible one-sided split. null = the tab has no panes left.
export function removeLeaf(node, id) {
  if (!node) return null;
  if (node.type === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}
