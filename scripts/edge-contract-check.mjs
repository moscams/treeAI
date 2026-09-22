/*
 * Replicates the React Flow v11 contracts behind the disappearing-edge bug:
 *
 *   - createNodeInternals: `internals = { ...node, positionAbsolute }`, and it
 *     only preserves `handleBounds` from the previous internals (via the symbol),
 *     NOT width/height. So width/height come from the node object we pass in.
 *   - applyNodeChanges: `const updateItem = { ...item }` — dimensions are written
 *     into a COPY, so the measurements only ever land in the `nodes` state.
 *   - getNodeData().isValid: requires handleBounds && width && height.
 *
 * Then it simulates a streaming rebuild with both data sources and asserts that
 * edges stay valid only when `previous` comes from the `nodes` state.
 */

const INTERNALS = Symbol('internals');

function createNodeInternals(nodes, prevInternals) {
  const next = new Map();
  for (const node of nodes) {
    const curr = prevInternals.get(node.id);
    next.set(node.id, {
      ...node,
      positionAbsolute: { x: node.position.x, y: node.position.y },
      [INTERNALS]: { handleBounds: curr?.[INTERNALS]?.handleBounds },
    });
  }
  return next;
}

function applyNodeChanges(changes, nodes) {
  let next = nodes;
  for (const change of changes) {
    next = next.map((item) => {
      if (item.id !== change.id) return item;
      const updateItem = { ...item }; // <-- the copy that broke the old fix
      if (change.type === 'dimensions') {
        updateItem.width = change.dimensions.width;
        updateItem.height = change.dimensions.height;
      }
      return updateItem;
    });
  }
  return next;
}

function measure(internals, onNodesChange) {
  const changes = [];
  for (const id of ['A', 'B']) {
    const node = internals.get(id);
    const dimensions = { width: 560, height: 420 };
    internals.set(id, {
      ...node,
      [INTERNALS]: {
        ...node[INTERNALS],
        handleBounds: { source: [{}], target: [{}] },
      },
      ...dimensions,
    });
    changes.push({ id, type: 'dimensions', dimensions });
  }
  onNodesChange(changes);
}

function getNodeData(node) {
  const handleBounds = node?.[INTERNALS]?.handleBounds || null;
  return !!(
    handleBounds &&
    node?.width &&
    node?.height &&
    typeof node?.positionAbsolute?.x !== 'undefined' &&
    typeof node?.positionAbsolute?.y !== 'undefined'
  );
}

function buildFlowNode(node, data, previous) {
  return { ...previous, id: node.id, position: node.position, data };
}

function run(useNodesState) {
  // What we first hand to React Flow: no measurements yet.
  let nodesState = [
    { id: 'A', position: { x: 0, y: 0 }, data: { rev: 0 } },
    { id: 'B', position: { x: 0, y: 500 }, data: { rev: 0 } },
  ];
  const handedOut = new Map(nodesState.map((n) => [n.id, n])); // used to be nodeCacheRef

  let internals = createNodeInternals(nodesState, new Map());
  measure(internals, (changes) => {
    nodesState = applyNodeChanges(changes, nodesState);
  });
  // nodesState now has width/height; handedOut still does not.

  const previous = useNodesState
    ? new Map(nodesState.map((n) => [n.id, n])) // synced from state (the fix)
    : handedOut; // cache of handed-out objects (the bug)

  // Streaming rebuild: same shape as ChatFlow's render effect.
  const rebuilt = nodesState.map((n) =>
    buildFlowNode(n, { rev: (n.data.rev ?? 0) + 1 }, previous.get(n.id))
  );
  internals = createNodeInternals(rebuilt, internals);

  return getNodeData(internals.get('A')) && getNodeData(internals.get('B'));
}

const oldValid = run(false);
const newValid = run(true);

console.log('old (previous from handed-out cache):', oldValid ? 'valid' : 'INVALID (edge hidden)');
console.log('new (previous from nodes state):     ', newValid ? 'valid' : 'INVALID (edge hidden)');

if (oldValid !== false || newValid !== true) {
  console.error('\nFAIL: expected old=false, new=true');
  process.exit(1);
}
console.log('\nPASS: the data source is what fixes it.');
