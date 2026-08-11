// Pure operations over a tab's binary split layout tree. No DOM — the
// shapes here are just data, and sessionManager.js renders whatever tree
// these produce. Kept separate from sessionManager so the tree algebra
// (which is the fiddly part: collapsing a split when one side closes,
// nesting a split inside a split) can be reasoned about and tested on its
// own, without a Terminal or a daemon connection in the picture.
//
//   leaf   { type: "leaf", id, session, paneEl }
//   split  { type: "split", dir: "row" | "column", a, b, fraction }
//
// Every function is non-mutating: they return a new tree and leave the
// input alone, so a caller can always compare against the previous tree.

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

// Returns a new tree with the leaf `id` replaced by `replacement` — how a
// split is introduced: the leaf being split becomes a split node holding
// itself plus the new leaf.
export function replaceLeaf(node, id, replacement) {
  if (!node) return node;
  if (node.type === "leaf") return node.id === id ? replacement : node;
  return {
    ...node,
    a: replaceLeaf(node.a, id, replacement),
    b: replaceLeaf(node.b, id, replacement),
  };
}

// Returns a new tree with leaf `id` gone. A split that loses one side
// collapses into its surviving side rather than lingering as a split with
// an empty half — without that, closing panes would leave the layout full
// of invisible one-sided splits and their dividers. null means the tree is
// now empty (the tab has no panes left).
export function removeLeaf(node, id) {
  if (!node) return null;
  if (node.type === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}
