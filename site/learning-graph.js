'use strict';

// The reading graph is a projection. Every visible segment refers back to real,
// editable edges, and each relay carries only the knowledge of its named source.
const LearningGraph = (() => {
  function adjacency(nodes) {
    return new Map(nodes.map(node => [node.id, []]));
  }

  function topological(nodes, outgoing) {
    const indegree = new Map(nodes.map(node => [node.id, 0]));
    for (const list of outgoing.values()) {
      for (const edge of list) indegree.set(edge.target, indegree.get(edge.target) + 1);
    }
    const queue = nodes.map(node => node.id).filter(id => !indegree.get(id));
    for (let i = 0; i < queue.length; i++) {
      for (const edge of outgoing.get(queue[i])) {
        const degree = indegree.get(edge.target) - 1;
        indegree.set(edge.target, degree);
        if (degree === 0) queue.push(edge.target);
      }
    }
    return queue;
  }

  function findPath(outgoing, source, target, requiredOnly = false) {
    const previous = new Map([[source, null]]), queue = [source];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] === target) {
        const path = [];
        for (let id = target; id !== source;) {
          const edge = previous.get(id);
          path.push(edge.index);
          id = edge.source;
        }
        return path.reverse();
      }
      for (const edge of outgoing.get(queue[i])) {
        if (requiredOnly && edge.kind !== 'prerequisite') continue;
        if (previous.has(edge.target)) continue;
        previous.set(edge.target, edge);
        queue.push(edge.target);
      }
    }
    return null;
  }

  function acyclicEdges(nodes, main) {
    let outgoing = adjacency(nodes);
    for (const edge of main) outgoing.get(edge.source).push(edge);
    let order = topological(nodes, outgoing);
    if (order.length === nodes.length) return {order, feedback:[]};

    // The map permits cycles involving suggested routes, but never a cycle
    // made of prerequisites. Keep all prerequisites, then retain routes unless
    // they would close a cycle. The full map still owns the feedback edges.
    outgoing = adjacency(nodes);
    const feedback = [];
    for (const edge of main) {
      if (edge.kind === 'prerequisite') outgoing.get(edge.source).push(edge);
    }
    if (topological(nodes, outgoing).length !== nodes.length) {
      throw new Error('必要前置形成循环，无法按学习顺序分层。');
    }
    for (const edge of main) {
      if (edge.kind !== 'route') continue;
      if (findPath(outgoing, edge.target, edge.source)) feedback.push(edge.index);
      else outgoing.get(edge.source).push(edge);
    }
    order = topological(nodes, outgoing);
    return {order, feedback};
  }

  function reduceEdges(nodes, main, order, feedback) {
    const rank = new Map(order.map((id,i) => [id,i]));
    const span = e => rank.get(e.target) - rank.get(e.source);
    const excluded = new Set(feedback);
    const candidates = main.filter(e => !excluded.has(e.index));
    // Every edge on an alternative path is shorter in a topological ordering.
    // Process those first, so witnesses always use edges that actually survive.
    candidates.sort((a,b) => span(a) - span(b) ||
      Number(b.kind === 'prerequisite') - Number(a.kind === 'prerequisite') || a.index - b.index);
    const outgoing = adjacency(nodes), kept = [], omitted = [], witnesses = new Map();
    for (const edge of candidates) {
      const path = findPath(outgoing, edge.source, edge.target, edge.kind === 'prerequisite');
      if (path) {
        omitted.push(edge.index);
        witnesses.set(edge.index, path);
      } else {
        kept.push(edge.index);
        outgoing.get(edge.source).push(edge);
        witnesses.set(edge.index, [edge.index]);
      }
    }
    kept.sort((a,b) => a-b);
    omitted.sort((a,b) => a-b);
    return {outgoing, kept, omitted, witnesses};
  }

  function learningRows(nodes, order, outgoing, maxPerRow, orderOf) {
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const levels = new Map(nodes.map(n => [n.id, n.level]));
    const originalOrder = new Map(nodes.map((n,i) => {
      const hint = orderOf?.(n);
      return [n.id, Number.isFinite(hint) ? hint : i];
    }));
    const incoming = adjacency(nodes);
    const bands = new Map();
    for (const id of order) {
      const level = levels.get(id);
      if (!bands.has(level)) bands.set(level, []);
      bands.get(level).push(id);
      for (const edge of outgoing.get(id)) {
        // An edited predecessor may lie in a deeper water layer. In this reading
        // view only, move its successors down far enough to respect the arrows.
        levels.set(edge.target, Math.max(levels.get(edge.target), level));
        incoming.get(edge.target).push(id);
      }
    }
    const rows = [], rowLevels = [], vertices = new Map();
    for (const level of [...bands.keys()].sort((a,b) => a-b)) {
      const ids = bands.get(level);
      let remaining = new Set(ids);
      const height = new Map();
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i];
        let depth = 0;
        for (const edge of outgoing.get(id)) {
          if (levels.get(edge.target) === level) depth = Math.max(depth, 1 + height.get(edge.target));
        }
        height.set(id, depth);
      }
      while (remaining.size) {
        const ready = [...remaining].filter(id => incoming.get(id).every(parent => !remaining.has(parent)));
        ready.sort((a,b) => height.get(b)-height.get(a) || originalOrder.get(a)-originalOrder.get(b));
        const batch = ready.slice(0,maxPerRow).sort((a,b) => originalOrder.get(a)-originalOrder.get(b));
        const row = batch.map((id,column) => {
          const vertex = {id, nodeId:id, kind:'node', row:rows.length, column, level:nodeById.get(id).level};
          vertices.set(id, vertex);
          remaining.delete(id);
          return vertex;
        });
        rows.push(row);
        rowLevels.push(level);
      }
    }
    return {rows, rowLevels, vertices};
  }

  function routeSegments(rows, vertices, kept, edges) {
    const tracks = new Map(), segments = [];
    let prefix = '@relay/';
    while ([...vertices.keys()].some(id => id.startsWith(prefix))) prefix = '@'+prefix;
    for (const index of kept) {
      const edge = edges[index], source = vertices.get(edge.source), target = vertices.get(edge.target);
      let from = source;
      if (!tracks.has(source.id)) tracks.set(source.id, new Map());
      const track = tracks.get(source.id);
      for (let r = source.row+1; r < target.row; r++) {
        let step = track.get(r);
        if (!step) {
          const id = prefix + vertices.size;
          const vertex = {id, nodeId:source.id, kind:'relay', row:r, column:rows[r].length, level:source.level};
          vertices.set(id,vertex);
          rows[r].push(vertex);
          const segment = {source:from.id, target:id, kind:edge.kind, edgeIndices:[]};
          step = {vertex,segment};
          track.set(r,step);
          segments.push(segment);
        }
        step.segment.edgeIndices.push(index);
        if (edge.kind === 'prerequisite') step.segment.kind = 'prerequisite';
        from = step.vertex;
      }
      // Only the last segment enters a real topic. It keeps the original
      // relation type even when its prefix is shared with a stronger dependency.
      segments.push({source:from.id, target:target.id, kind:edge.kind, edgeIndices:[index]});
    }
    return segments;
  }

  function orderRows(rows, vertices, segments) {
    const neighbours = new Map([...vertices.keys()].map(id => [id,{up:[],down:[]}]));
    for (const edge of segments) {
      neighbours.get(edge.source).down.push(vertices.get(edge.target));
      neighbours.get(edge.target).up.push(vertices.get(edge.source));
    }
    const relative = v => (v.column + .5) / rows[v.row].length;
    const reorder = (row,dir) => {
      const weights = new Map(row.map(v => {
        const adjacent = neighbours.get(v.id)[dir];
        const position = adjacent.length
          ? adjacent.reduce((sum,n) => sum + relative(n),0)/adjacent.length
          : relative(v);
        return [v.id,position];
      }));
      row.sort((a,b) => weights.get(a.id)-weights.get(b.id) || a.column-b.column);
      row.forEach((v,i) => {v.column=i;});
    };
    // Ordering changes horizontal placement only. Sweeping in both directions
    // lets branch points as well as their destinations pull neighbours together.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < rows.length; i++) reorder(rows[i],'up');
      for (let i = rows.length-2; i >= 0; i--) reorder(rows[i],'down');
    }
  }

  function build(view, options = {}) {
    const {nodes,edges} = view;
    const main = [], perspectives = [];
    edges.forEach((edge,index) => {
      if (edge.kind === 'perspective') perspectives.push(index);
      else main.push({source:edge.source, target:edge.target, kind:edge.kind, index});
    });
    const {order,feedback} = acyclicEdges(nodes, main);
    const {outgoing,kept,omitted,witnesses} = reduceEdges(nodes, main, order, feedback);
    const limit = Number.isFinite(options.maxPerRow) ? Math.max(1, Math.floor(options.maxPerRow)) : Infinity;
    const {rows,rowLevels,vertices} = learningRows(nodes, order, outgoing, limit, options.orderOf);
    const segments = routeSegments(rows, vertices, kept, edges);
    orderRows(rows,vertices,segments);
    return {rows, rowLevels, vertices, segments, kept, omitted, feedback, perspectives, witnesses};
  }

  return {build};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LearningGraph;
if (typeof window !== 'undefined') window.LearningGraph = LearningGraph;
