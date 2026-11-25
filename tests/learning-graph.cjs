'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');
const {build} = require('../site/learning-graph.js');

const atlas = JSON.parse(readFileSync(join(__dirname, '../content/map.json'), 'utf8'));
const overview = atlas.views.find(view => view.id === 'overview');

function edge(source, target, kind = 'route') {
  return {source, target, kind};
}

function fixture(levels, edges) {
  const nodes = Object.entries(levels).map(([id, level]) => ({id, label:id, level}));
  return {id:'fixture', title:'Fixture', nodes, edges};
}

function filtered(view, ids) {
  const nodes = view.nodes.filter(node => ids.has(node.id));
  const edges = view.edges.filter(e => ids.has(e.source) && ids.has(e.target));
  return {...view, nodes, edges};
}

// Independent reachability oracle, oblivious to graph layout and the choice of witness.
function reach(edges, source, requiredOnly) {
  const next = new Map();
  for (const e of edges) {
    if (e.kind === 'perspective' || (requiredOnly && e.kind !== 'prerequisite')) continue;
    if (!next.has(e.source)) next.set(e.source, []);
    next.get(e.source).push(e.target);
  }
  const seen = new Set([source]);
  const todo = [source];
  while (todo.length) {
    for (const target of next.get(todo.pop()) || []) {
      if (seen.has(target)) continue;
      seen.add(target);
      todo.push(target);
    }
  }
  return seen;
}

function checkedBuild(view, options) {
  const original = JSON.stringify(view);
  const graph = build(view, options);
  assert.equal(JSON.stringify(view), original, `${view.id}: projection modified course data`);

  const ids = view.nodes.map(node => node.id);
  const edgesWithFeedback = [...graph.segments, ...graph.feedback.map(i => view.edges[i])];
  for (const id of ids) {
    assert.equal(graph.vertices.get(id)?.kind, 'node', `${view.id}: lost topic ${id}`);
    for (const requiredOnly of [false, true]) {
      const expected = reach(view.edges, id, requiredOnly);
      const actual = reach(edgesWithFeedback, id, requiredOnly);
      const projectTopics = seen => ids.filter(k => seen.has(k));
      assert.deepEqual(projectTopics(actual), projectTopics(expected),
        `${view.id} from ${id}, requiredOnly=${requiredOnly}`);
    }
  }

  const allInRows = graph.rows.flat().map(v => v.id);
  assert.equal(new Set(allInRows).size, allInRows.length, 'vertex appears in several rows');
  assert.deepEqual(new Set(allInRows), new Set(graph.vertices.keys()));
  for (const segment of graph.segments) {
    const a = graph.vertices.get(segment.source);
    const b = graph.vertices.get(segment.target);
    assert.ok(a && b);
    assert.equal(b.row, a.row + 1, `${view.id}: segment skips a visual row`);
    assert.ok(segment.edgeIndices.length > 0, 'segment would invent a relationship');
    for (const index of segment.edgeIndices) {
      assert.ok(graph.kept.includes(index));
      assert.notEqual(view.edges[index].kind, 'perspective');
    }
  }
  const categories = [...graph.kept, ...graph.omitted, ...graph.feedback, ...graph.perspectives];
  assert.deepEqual(categories.sort((a,b) => a-b), view.edges.map((_,i) => i),
    'every original edge must be present exactly once');
  for (const index of graph.perspectives) assert.equal(view.edges[index].kind, 'perspective');
  for (const index of graph.feedback) assert.equal(view.edges[index].kind, 'route');
  for (const index of graph.kept) {
    const e = view.edges[index];
    const owned = graph.segments.filter(segment => segment.edgeIndices.includes(index));
    assert.ok(reach(owned, e.source, e.kind === 'prerequisite').has(e.target),
      `${view.id}: displayed segments cannot trace original edge ${index}`);
    const intermediate = new Set(owned.flatMap(segment => [segment.source, segment.target]));
    intermediate.delete(e.source);
    intermediate.delete(e.target);
    for (const id of intermediate) {
      const vertex = graph.vertices.get(id);
      assert.equal(vertex.kind, 'relay');
      assert.equal(vertex.nodeId, e.source, 'a continuation must name its actual origin');
    }
  }
  for (const index of graph.omitted) {
    const e = view.edges[index];
    let current = e.source;
    for (const step of graph.witnesses.get(index)) {
      assert.ok(graph.kept.includes(step), 'a reading path must use surviving original relations');
      assert.equal(view.edges[step].source, current, 'a reading path must continue where the last step ends');
      if (e.kind === 'prerequisite') assert.equal(view.edges[step].kind, 'prerequisite');
      current = view.edges[step].target;
    }
    assert.equal(current, e.target);
  }
  return graph;
}

test('all course diagrams preserve both kinds of reachability and use adjacent rows', () => {
  for (const view of atlas.views) checkedBuild(view);
});

test('each of the four filtered oceans retains the paths available in that selection', () => {
  const roots = {
    algebra:['numbers','elementary'], geometry:['geometry','plane-geometry'],
    number:['numbers','discrete'], combinatorics:['language','discrete'],
  };
  for (const [field, base] of Object.entries(roots)) {
    const worlds = new Set([...base, ...atlas.views.filter(v => v.olympiadField === field).map(v => v.id)]);
    const ids = new Set(overview.nodes.filter(n => worlds.has(n.target)).map(n => n.id));
    checkedBuild(filtered(overview, ids));
  }
});

test('a diamond retains each branch; removing the intermediate restores the direct dependency', () => {
  const view = fixture({A:0,B:1,C:1,D:2}, [
    edge('A','B','prerequisite'), edge('B','D','prerequisite'),
    edge('A','C'), edge('C','D'), edge('A','D','prerequisite'),
  ]);
  const graph = checkedBuild(view);
  assert.deepEqual(new Set(graph.kept), new Set([0,1,2,3]));
  assert.deepEqual(graph.omitted, [4]);
  assert.deepEqual(graph.witnesses.get(4), [0,1]);
  const narrowed = filtered(view, new Set(['A','C','D']));
  assert.equal(checkedBuild(narrowed).omitted.length, 0);
});

test('perspectives cannot be prerequisites or replace a learning route', () => {
  const view = fixture({A:0,B:1,C:1,D:2}, [
    edge('A','B','perspective'), edge('B','D','prerequisite'), edge('A','D'),
    edge('A','C'), edge('C','D','perspective'),
  ]);
  const graph = checkedBuild(view);
  assert.ok(graph.kept.includes(2));
  assert.equal(graph.perspectives.length, 2);
});

test('long edges preserve their origin and mixed relation types through intermediate rows', () => {
  const view = fixture({A:0,X:0,B:1,C:2,P:3,Q:3}, [
    edge('X','B'), edge('B','C'), edge('C','P'), edge('C','Q'),
    edge('A','P','prerequisite'), edge('A','Q'),
  ]);
  const graph = checkedBuild(view);
  assert.ok(graph.vertices.get('P').row > graph.vertices.get('A').row + 1);
  const relays = [...graph.vertices.values()].filter(v => v.kind === 'relay' && v.nodeId === 'A');
  assert.ok(relays.length, 'a long indispensable edge needs an explicit continuation');
  for (const v of relays) {
    assert.ok(!view.nodes.some(n => n.id === v.id));
    assert.equal(graph.vertices.get(v.nodeId).kind, 'node');
  }
  // Users choose their own IDs; a key chosen for a continuation cannot shadow an actual topic.
  const extra = {...view, nodes:[...view.nodes, {id:relays[0].id, label:'Another topic', level:0}]};
  checkedBuild(extra);
});

test('a feedback cycle is traceable while a required cycle cannot become a learning order', () => {
  const mixed = fixture({A:0,B:1,C:2}, [
    edge('A','B','prerequisite'), edge('B','C','prerequisite'), edge('C','A'),
  ]);
  assert.deepEqual(checkedBuild(mixed).feedback, [2]);
  const broken = fixture({A:0,B:1}, [edge('A','B','prerequisite'), edge('B','A','prerequisite')]);
  assert.throws(() => build(broken));
});

test('empty and disconnected views are supported without attaching unrelated knowledge', () => {
  checkedBuild(fixture({}, []));
  checkedBuild(fixture({A:0,B:20,C:40}, []));
});

test('narrow rows and direct duplicate relations keep ownership and prerequisites', () => {
  const view = fixture({A:0,B:0,C:0,D:1,E:1,F:2}, [
    edge('A','D'), edge('A','D','prerequisite'), edge('B','D'),
    edge('C','E','prerequisite'), edge('D','F'), edge('E','F'),
  ]);
  checkedBuild(view, {maxPerRow:2});
});

test('a converging route cannot be used backwards to replace another dependency', () => {
  const view = fixture({A:0,B:0,C:1,D:2}, [
    edge('A','C'), edge('B','C'), edge('B','D'), edge('A','D'),
  ]);
  assert.deepEqual(checkedBuild(view).omitted, []);
});
