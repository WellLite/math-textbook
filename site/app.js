'use strict';
const $ = (id) => document.getElementById(id),
  NS = 'http://www.w3.org/2000/svg';
const svg = $('map'),
  scene = $('scene'),
  inspector = $('inspector');
const TYPES = { route: '推进路线', prerequisite: '必要前置', perspective: '理解联系' };
const LEGACY_LESSON_SECTIONS = [
  ['question', '从什么问题出发'],
  ['exploration', '尝试、碰壁与改进'],
  ['derivation', '一步步推导'],
  ['statement', '定义、结论与适用条件'],
  ['applications', '例子与应用'],
  ['proof', '附录 · 书面证明'],
];
const COLORS = [
  '#4b6c9e',
  '#367d85',
  '#7e6ca7',
  '#4a79b8',
  '#ad8956',
  '#6c78b6',
  '#458b9a',
  '#a077a5',
  '#4b8a7a',
  '#5d79a6',
  '#9a7db0',
  '#688d86',
];

let data,
  scope = 'overview',
  selection = null;
let camera = { x: 0, y: 0, k: 1 },
  gesture = null,
  toastTimer = null;
let navigationReady = false,
  keepTopicCentered = false,
  topicLayout = null;
let showAllLinks = false,
  learningLayout = null;
const adjacentMode = () => !showAllLinks;
const olympiadFields = {
  algebra: {
    name: '代数',
    roots: ['numbers', 'elementary'],
    question: '同一个式子能怎样改写？从取等、找根和代入特值，逐步发现约束。',
  },
  geometry: {
    name: '几何',
    roots: ['geometry', 'plane-geometry'],
    question: '图中哪些角、长度比或圆保持不变？沿着它们追踪点与线的关系。',
  },
  number: {
    name: '数论',
    roots: ['numbers', 'discrete'],
    question: '一个数可能有哪些因子？先用余数缩小范围，再研究整数解。',
  },
  combinatorics: {
    name: '组合',
    roots: ['language', 'discrete'],
    question: '对象太多，怎样数清或证明一定存在？尝试换一种计数、配对或观察操作前后的变化。',
  },
};
let oceanField = '',
  directoryReturn = '',
  frameWholeOcean = false;
function oceanData() {
  if (!oceanField) return data;
  const roots = olympiadFields[oceanField].roots;
  const visible = new Set(
    worlds()
      .filter((v) => v.olympiadField === oceanField || roots.includes(v.id))
      .map((v) => v.id),
  );
  const ov = overview(),
    nodes = ov.nodes.filter((n) => visible.has(n.target)),
    ids = new Set(nodes.map((n) => n.id));
  const filtered = { ...ov, nodes, edges: ov.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  return {
    ...data,
    depthBands: (data.depthBands || []).filter((b) => nodes.some((n) => n.level === b.level)),
    views: [filtered, ...worlds().filter((v) => visible.has(v.id))],
    layout: { ...data.layout, worlds: {} },
  };
}
const overview = () => data.views.find((v) => v.id === 'overview');
const view = (id) => data.views.find((v) => v.id === id);
const worlds = () => data.views.filter((v) => v.id !== 'overview');
const worldTitle = (id) => overview().nodes.find((n) => n.target === id)?.label || view(id)?.title || id;
const color = (id) =>
  COLORS[
    Math.max(
      0,
      worlds().findIndex((v) => v.id === id),
    ) % COLORS.length
  ];
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}
function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
function html(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(label, fn, className = '') {
  const e = html('button', { type: 'button', class: className }, label);
  e.addEventListener('click', fn);
  return e;
}
function prepareTopicLayout(world) {
  const rows = new Map(),
    positions = new Map();
  for (const node of world.nodes) {
    if (!rows.has(node.level)) rows.set(node.level, []);
    rows.get(node.level).push(node);
  }
  const levels = [...rows.keys()].sort((a, b) => a - b);
  levels.forEach((level, index) => {
    const peers = rows.get(level);
    const widths = peers.map((node) => Math.max(72, Array.from(node.label).length * 18 + 32));
    const rowWidth = widths.reduce((a, b) => a + b, 0) + 32 * (peers.length - 1);
    let left = -rowWidth / 2;
    peers.forEach((node, i) => {
      positions.set(node.id, { x: left + widths[i] / 2, y: (index - (levels.length - 1) / 2) * 112 });
      left += widths[i] + 32;
    });
  });
  return { world, positions };
}
function nodePos(id, nid) {
  if (adjacentMode() && scope === id) return learningMap().layout.position(nid);
  const manual = data.layout?.nodes?.[id]?.[nid];
  if (manual) return manual;
  const world = view(id);
  if (!topicLayout || topicLayout.world !== world) topicLayout = prepareTopicLayout(world);
  return topicLayout.positions.get(nid);
}
function learningMap() {
  if (learningLayout?.scope === scope && learningLayout.field === oceanField) return learningLayout;
  const isOverview = scope === 'overview',
    map = isOverview ? oceanData() : data;
  const course = map.views.find((v) => v.id === scope),
    graph = LearningGraph.build(course, { maxPerRow: 5 });
  const layout = LearningView.layout(course, graph, { overview: isOverview });
  learningLayout = { scope, field: oceanField, map, course, graph, layout };
  return learningLayout;
}
function showLearningEdges(indices) {
  const { course } = learningMap(),
    source = view(scope);
  const originals = [
    ...new Set(indices.map((i) => source.edges.indexOf(course.edges[i])).filter((i) => i >= 0)),
  ];
  if (originals.length === 1) select({ type: 'edge', world: scope, index: originals[0] });
  else if (originals.length) select({ type: 'bundle', world: scope, indices: originals });
}
function topicLineage(course, graph, id) {
  const parents = new Map(),
    edges = new Set(),
    nodes = new Set([id]);
  for (const i of graph.kept) {
    const edge = course.edges[i];
    if (edge.kind === 'prerequisite') {
      if (!parents.has(edge.target)) parents.set(edge.target, []);
      parents.get(edge.target).push(i);
    }
    if (edge.source === id || edge.target === id) {
      edges.add(i);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  }
  const visited = new Set([id]),
    pending = [id];
  while (pending.length) {
    for (const i of parents.get(pending.pop()) || []) {
      const parent = course.edges[i].source;
      edges.add(i);
      nodes.add(parent);
      if (!visited.has(parent)) {
        visited.add(parent);
        pending.push(parent);
      }
    }
  }
  return { edges, nodes };
}
function currentBounds() {
  if (scope === 'overview') return OceanMap.bounds(oceanData());
  const nodes = view(scope)?.nodes || [];
  if (!nodes.length) return { x: -200, y: -160, w: 400, h: 320 };
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const node of nodes) {
    const p = nodePos(scope, node.id),
      half = Math.max(30, Array.from(node.label).length * 9);
    left = Math.min(left, p.x - half - 22);
    right = Math.max(right, p.x + half + 22);
    top = Math.min(top, p.y - 48);
    bottom = Math.max(bottom, p.y + 70);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
function fit() {
  keepTopicCentered = false;
  if (!data) return;
  const r = svg.getBoundingClientRect();
  if (adjacentMode()) {
    camera = LearningView.fit(learningMap().layout, r, { opening: !frameWholeOcean });
    renderCanvas();
    return;
  }
  if (scope === 'overview') {
    camera = frameWholeOcean ? OceanMap.fit(oceanData(), r) : OceanMap.opening(oceanData(), r);
    renderCanvas();
    return;
  }
  const b = currentBounds();
  camera.k = Math.max(0.001, Math.min((r.width - 50) / b.w, (r.height - 105) / b.h, 1.65));
  camera.x = r.width / 2 - (b.x + b.w / 2) * camera.k;
  camera.y = (r.height - 35) / 2 - (b.y + b.h / 2) * camera.k;
  renderCanvas();
}
function zoom(factor, point) {
  keepTopicCentered = false;
  const r = svg.getBoundingClientRect(),
    p = point || { x: r.width / 2, y: r.height / 2 };
  const k = Math.min(3.2, Math.max(0.001, camera.k * factor));
  camera.x = p.x - ((p.x - camera.x) * k) / camera.k;
  camera.y = p.y - ((p.y - camera.y) * k) / camera.k;
  camera.k = k;
  renderCanvas();
}
function select(ref) {
  selection = ref;
  keepTopicCentered = false;
  replaceTopicAddress();
  renderCanvas();
  renderInspector();
  if (ref && matchMedia('(max-width:640px)').matches) {
    inspector.scrollIntoView({ block: 'start' });
  }
}
function enter(id) {
  frameWholeOcean = false;
  scope = id;
  selection = id === 'overview' ? null : { type: 'world', world: id };
  render();
  fit();
}

function actionNode(ref) {
  if (ref.type === 'world') enter(ref.world);
  else select(ref);
}
function interactive(g, ref, label) {
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.setAttribute('aria-label', label);
  g.dataset.ref = JSON.stringify(ref);
  g.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      actionNode(ref);
    }
  });
}
function pathBetween(a, b, ra = 0, rb = 0) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy) || 1;
  const p = { x: a.x + (dx * ra) / d, y: a.y + (dy * ra) / d },
    q = { x: b.x - (dx * rb) / d, y: b.y - (dy * rb) / d };
  if (Math.abs(dy) < 60) return `M${p.x},${p.y} Q${(p.x + q.x) / 2},${p.y - 55} ${q.x},${q.y}`;
  return `M${p.x},${p.y} C${p.x},${p.y + dy * 0.45} ${q.x},${q.y - dy * 0.45} ${q.x},${q.y}`;
}
function edgeElement(edge, ref, path) {
  const g = el('g');
  const selected =
    selection?.type === 'edge' && selection.world === ref.world && selection.index === ref.index;
  g.append(el('path', { d: path, class: 'edge ' + edge.kind + (selected ? ' selected' : '') }));
  const hit = el('path', {
    d: path,
    class: 'edge-hit',
    role: 'button',
    tabindex: 0,
    'aria-label': '联系：' + (edge.label || '未命名联系'),
  });
  hit.dataset.edge = JSON.stringify(ref);
  hit.addEventListener('click', (e) => {
    e.stopPropagation();
    select(ref);
  });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      select(ref);
    }
  });
  g.append(hit);
  return g;
}
function renderCanvas() {
  if (!data) return;
  scene.classList.remove('trace-world');
  svg.classList.toggle('ocean-overview', scope === 'overview');
  scene.replaceChildren();
  scene.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.k})`);
  $('zoom-value').textContent = Math.round(camera.k * 100) + '%';
  svg.classList.toggle('adjacent-map', adjacentMode());
  $('perspective-key').hidden = adjacentMode();
  $('relay-key').hidden = true;
  if (adjacentMode()) {
    const { map, course, graph, layout } = learningMap();
    $('relay-key').hidden = graph.vertices.size === course.nodes.length;
    const selected = new Set();
    if (selection?.world === scope) {
      const indices =
        selection.type === 'edge' ? [selection.index] : selection.type === 'bundle' ? selection.indices : [];
      for (const index of indices) {
        const projected = course.edges.indexOf(view(scope).edges[index]);
        for (const i of graph.witnesses.get(projected) || [projected]) selected.add(i);
      }
    }
    const focus =
      selection?.type === 'node' && selection.world === scope
        ? topicLineage(course, graph, selection.node)
        : null;
    LearningView.render(scene, layout, {
      camera,
      rect: svg.getBoundingClientRect(),
      data: map,
      scope,
      selection,
      interactive,
      color,
      worldTitle,
      onEdge: showLearningEdges,
      edgeIsSelected: (i) => selected.has(i),
      edgeIsRelated: focus ? (i) => focus.edges.has(i) : null,
      nodeIsRelated: focus ? (id) => focus.nodes.has(id) : null,
    });
  } else if (scope === 'overview') {
    const map = oceanData(),
      visibleWorlds = map.views.filter((v) => v.id !== 'overview');
    scene.append(OceanMap.background(map, camera, svg.getBoundingClientRect()));
    const routes = OceanMap.routes(map, camera.k);
    const targets = new Map(overview().nodes.map((node) => [node.id, node.target]));
    overview().edges.forEach((edge, index) => {
      if (!routes.has(edge)) return;
      const line = edgeElement(edge, { type: 'edge', world: 'overview', index }, routes.get(edge));
      line.dataset.endpoints = JSON.stringify([targets.get(edge.source), targets.get(edge.target)]);
      scene.append(line);
    });
    (data.crossEdges || []).forEach((edge, index) => {
      const ends = [edge.source, edge.target];
      if (!ends.every((end) => visibleWorlds.some((v) => v.id === end.view))) return;
      const touches =
        selection?.type === 'node' &&
        ends.some((end) => end.view === selection.world && end.node === selection.node);
      if (
        !touches &&
        !(selection?.type === 'edge' && selection.world === 'cross' && selection.index === index)
      )
        return;
      const [a, b] = ends.map((end) => OceanMap.satellite(map, end.view, end.node));
      scene.append(edgeElement(edge, { type: 'edge', world: 'cross', index }, pathBetween(a, b, 14, 14)));
    });
    for (const world of visibleWorlds) {
      scene.append(
        OceanMap.world(map, world, worldTitle(world.id), color(world.id), camera.k, selection, interactive),
      );
    }
  } else {
    const v = view(scope);
    if (!v) {
      scope = 'overview';
      return render();
    }
    const c = color(scope);
    const box = currentBounds();
    scene.append(
      el('rect', {
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        rx: 36,
        class: 'focus-boundary',
        style: '--world:' + c,
      }),
    );
    v.edges.forEach((e, i) =>
      scene.append(
        edgeElement(
          e,
          { type: 'edge', world: scope, index: i },
          pathBetween(nodePos(scope, e.source), nodePos(scope, e.target), 20, 22),
        ),
      ),
    );
    v.nodes.forEach((n, i) => {
      const p = nodePos(scope, n.id),
        selected = selection?.type === 'node' && selection.world === scope && selection.node === n.id;
      const g = el('g', { class: 'knowledge-node' + (selected ? ' selected' : ''), style: '--world:' + c });
      g.append(el('circle', { cx: p.x, cy: p.y, r: 19, class: 'satellite' }));
      g.append(el('text', { x: p.x, y: p.y + 5, 'font-size': 14, class: 'node-number' }, String(i + 1)));
      g.append(el('text', { x: p.x, y: p.y + 45, 'font-size': 18, class: 'node-label' }, n.label));
      interactive(g, { type: 'node', world: scope, node: n.id }, '知识点 ' + n.label);
      scene.append(g);
    });
  }

  $('map-hint').textContent = adjacentMode()
    ? '沿箭头逐层往下读，点线查看两端的联系。'
    : scope === 'overview'
      ? '点大圆展开板块，点小圆查看跨板块联系。'
      : '点知识点阅读讲解，点连线查看它们之间的联系。';
}
function renderNav() {
  const list = $('world-list');
  list.replaceChildren();
  for (const band of OceanMap.bands(data)) {
    const nodes = overview().nodes.filter((node) => node.level === band.level);
    if (!nodes.length) continue;
    list.append(html('div', { class: 'nav-depth' }, [band.title, band.subtitle].filter(Boolean).join(' · ')));
    for (const node of nodes) {
      const world = view(node.target);
      const item = button('', () => enter(world.id), 'world-nav' + (scope === world.id ? ' current' : ''));
      item.setAttribute('aria-label', '打开板块 ' + node.label);
      const swatch = html('span', { class: 'swatch' });
      swatch.style.background = color(world.id);
      item.append(
        swatch,
        html('span', { class: 'nav-name' }, node.label),
        html('span', { class: 'count' }, String(world.nodes.length)),
      );
      list.append(item);
    }
  }
  $('view-title').textContent =
    scope === 'overview'
      ? oceanField
        ? olympiadFields[oceanField].name + ' · 知识深度图'
        : '知识深度图'
      : worldTitle(scope);
  $('back').hidden = scope === 'overview' && !oceanField;
}
function heading(kicker, title) {
  inspector.append(html('div', { class: 'eyebrow' }, kicker), html('h2', {}, title));
}
function lessonParagraphs(lesson) {
  if (Array.isArray(lesson)) return lesson.map((part) => ({ ...part }));
  return LEGACY_LESSON_SECTIONS.filter(([key]) => lesson?.[key]).map(([key, title]) => {
    const part = { title, text: lesson[key] };
    if (key === 'proof') part.folded = true;
    return part;
  });
}
function appendLessonText(body, parts) {
  for (const part of parts) {
    if (!part.title?.trim() && !part.text.trim()) continue;
    const prose = html('p', { class: 'lesson-prose' }, part.text);
    if (part.folded) {
      const fold = html('details', { class: 'lesson-note' });
      fold.append(html('summary', {}, part.title || '补充'), prose);
      body.append(fold);
    } else {
      if (part.title) body.append(html('h4', {}, part.title));
      if (part.text) body.append(prose);
    }
  }
}
function edgeButton(world, index) {
  const v = view(world),
    e = v.edges[index],
    label = (id) => v.nodes.find((n) => n.id === id)?.label;
  const item = button(
    label(e.source) + ' → ' + label(e.target),
    () => {
      if (scope !== world) {
        scope = world;
        if (world === 'overview') oceanField = '';
        selection = { type: 'edge', world, index };
        render();
        fit();
      } else select({ type: 'edge', world, index });
    },
    'relation-item',
  );
  item.append(html('small', {}, TYPES[e.kind] + ' · ' + (e.label || '查看联系')));
  return item;
}
let requiredParents = null;
const topicKey = (world, node) => JSON.stringify([world, node]);
function appendPrerequisites(ref) {
  if (!requiredParents) {
    requiredParents = new Map();
    const add = (key, parent, edge) => {
      if (!requiredParents.has(key)) requiredParents.set(key, new Map());
      requiredParents.get(key).set(topicKey(parent.view, parent.node), { parent, edge });
    };
    for (const w of worlds())
      for (const e of w.edges) {
        if (e.kind === 'prerequisite') add(topicKey(w.id, e.target), { view: w.id, node: e.source }, e);
      }
    for (const e of data.crossEdges || []) {
      if (e.kind === 'prerequisite') add(topicKey(e.target.view, e.target.node), e.source, e);
    }
  }
  const parents = requiredParents.get(topicKey(ref.world, ref.node));
  if (!parents?.size) return;
  // If one parent already entails another, readers reach that ancestor on the next click.
  const earlier = new Set(),
    pending = [...parents.keys()].flatMap((k) => [...(requiredParents.get(k)?.keys() || [])]);
  while (pending.length) {
    const key = pending.pop();
    if (earlier.has(key)) continue;
    earlier.add(key);
    for (const k of requiredParents.get(key)?.keys() || []) pending.push(k);
  }
  const section = html('section', { class: 'learning-parents', 'aria-label': '上一步用到的知识' });
  section.append(html('h3', {}, '上一步用到的知识'));
  for (const [key, { parent, edge }] of parents) {
    if (earlier.has(key)) continue;
    const link = html('a', { href: topicHash(parent.view, parent.node) }, refLabel(parent));
    if (parent.view !== ref.world) link.append(html('small', {}, worldTitle(parent.view)));
    section.append(link);
    if (edge.why) section.append(html('p', {}, edge.why));
  }
  inspector.append(section);
}
function appendWitness(ref, edge) {
  if (!adjacentMode() || ref.world !== scope) return;
  const { course, graph } = learningMap(),
    path = graph.witnesses.get(course.edges.indexOf(edge));
  if (!path || path.length < 2) return;
  const section = html('section', { class: 'learning-path' });
  section.append(html('h3', {}, '图上的逐层路线'));
  const steps = html('ol');
  for (const id of [edge.source, ...path.map((index) => course.edges[index].target)]) {
    const node = course.nodes.find((n) => n.id === id),
      step = html('li');
    step.append(
      scope === 'overview'
        ? button(node.label, () => enter(node.target))
        : html('a', { href: topicHash(scope, id) }, node.label),
    );
    steps.append(step);
  }
  section.append(steps);
  inspector.append(section);
}
function appendWorldConnections(world) {
  const ov = overview(),
    entry = ov.nodes.find((n) => n.target === world),
    links = [];
  ov.edges.forEach((edge, i) => {
    if (edge.source === entry?.id || edge.target === entry?.id) links.push(edgeButton('overview', i));
  });
  if (links.length) inspector.append(html('h3', {}, '与其他板块的联系'), ...links);
}
function relationList(ref) {
  let count = 0;
  const v = view(ref.world);
  if (!v) return;
  if (ref.type === 'world') appendWorldConnections(ref.world);
  inspector.append(html('h3', {}, '相关联系'));
  v.edges.forEach((e, i) => {
    if (ref.type === 'node' && e.source !== ref.node && e.target !== ref.node) return;
    count++;
    const a = v.nodes.find((n) => n.id === e.source)?.label,
      b = v.nodes.find((n) => n.id === e.target)?.label;
    const bt = button(
      a + ' → ' + b,
      () => select({ type: 'edge', world: ref.world, index: i }),
      'relation-item',
    );
    bt.append(html('small', {}, TYPES[e.kind] + ' · ' + (e.label || '尚未命名')));
    inspector.append(bt);
  });
  (data.crossEdges || []).forEach((e, i) => {
    if (ref.type === 'node' && ![e.source, e.target].some((r) => r.view === ref.world && r.node === ref.node))
      return;
    if (ref.type === 'world' && ![e.source, e.target].some((r) => r.view === ref.world)) return;
    count++;
    const bt = button(
      refLabel(e.source) + ' → ' + refLabel(e.target),
      () => select({ type: 'edge', world: 'cross', index: i }),
      'relation-item',
    );
    bt.append(html('small', {}, '跨板块 · ' + TYPES[e.kind]));
    inspector.append(bt);
  });
  if (!count) inspector.append(html('p', { class: 'empty' }, '暂无相关联系。'));
}
function appendTopicMaterials(parent, node) {
  if (node.description) parent.append(html('p', { id: 'topic-preview' }, node.description));
  for (const example of Array.isArray(node.examples) ? node.examples : []) {
    const box = html('div', { class: 'topic-example' });
    box.append(
      html('strong', {}, example.id + (example.skill ? ' · ' + example.skill : '')),
      html('p', {}, example.why),
    );
    if (typeof example.url === 'string' && example.url.startsWith('https://'))
      box.append(html('a', { href: example.url, target: '_blank', rel: 'noopener' }, '查看题目来源 ↗'));
    parent.append(box);
  }
}
function appendEdgePassage(ref, edge) {
  const passage = html('div', { class: 'edge-passage' });
  if (edge.why) passage.append(html('p', {}, edge.why));
  if (ref.world === 'overview') {
    for (const id of [edge.source, edge.target]) {
      const n = overview().nodes.find((n) => n.id === id);
      passage.append(button(n.label, () => enter(n.target)));
    }
  } else {
    const ends =
      ref.world === 'cross'
        ? [edge.source, edge.target]
        : [edge.source, edge.target].map((node) => ({ view: ref.world, node }));
    for (const end of ends) passage.append(html('a', { href: topicHash(end.view, end.node) }, refLabel(end)));
  }
  inspector.append(passage);
}
function renderReadingSelection(ref) {
  if (ref.type === 'world') {
    const world = view(ref.world);
    const entry = overview().nodes.find((n) => n.target === world.id)?.entry;
    heading('数学板块', worldTitle(ref.world));
    if (entry) inspector.append(html('p', { class: 'intro' }, entry));
    if (world.nodes.length) inspector.append(html('h3', {}, '板块内的知识点'));
    for (const n of world.nodes)
      inspector.append(html('a', { class: 'topic-item', href: topicHash(world.id, n.id) }, n.label));
    appendWorldConnections(world.id);
  } else if (ref.type === 'node') {
    const node = view(ref.world)?.nodes.find((n) => n.id === ref.node);
    if (!node) return;
    heading(worldTitle(ref.world), node.label);
    const article = html('article', {
      class: 'student-article lesson-body',
      id: 'student-lesson',
      'aria-label': node.label + '的讲解',
    });
    if (node.chapter)
      article.append(
        html('a', { class: 'chapter-link', href: node.chapter.replace(/\.md$/, '.html') }, '阅读本节正文'),
      );
    appendLessonText(article, lessonParagraphs(node.lesson));
    if (!article.childElementCount && !String(node.description || '').trim())
      article.append(html('p', { class: 'empty' }, '这个知识点的讲解尚未写好。'));
    appendTopicMaterials(article, node);
    inspector.append(article);
    appendPrerequisites(ref);
    if (scope !== ref.world) inspector.append(button('展开所在板块', () => enter(ref.world), 'topic-item'));
    if (node.target) inspector.append(button('前往关联板块', () => enter(node.target), 'topic-item'));
    relationList(ref);
  } else if (ref.type === 'edge') {
    const edges = ref.world === 'cross' ? data.crossEdges : view(ref.world)?.edges,
      edge = edges?.[ref.index];
    if (!edge) return;
    heading(TYPES[edge.kind], edge.label || '知识之间的联系');
    appendEdgePassage(ref, edge);
    appendWitness(ref, edge);
  }
}

function renderInspector() {
  const overviewOnly = scope === 'overview' && !selection;
  document.querySelector('.workspace').classList.toggle('wide-map', overviewOnly);
  inspector.replaceChildren();
  if (!data || overviewOnly) return;
  if (scope === 'overview') inspector.append(button('返回深度图', () => select(null)));
  if (selection?.type === 'bundle') {
    heading('逐层路线', '这段线通往哪里');
    for (const index of selection.indices) inspector.append(edgeButton(selection.world, index));
  } else {
    renderReadingSelection(selection || { type: 'world', world: scope });
  }
}
function render() {
  topicLayout = null;
  learningLayout = null;
  requiredParents = null;
  replaceTopicAddress();
  renderNav();
  renderCanvas();
  renderInspector();
}
function refLabel(r) {
  return view(r.view)?.nodes.find((n) => n.id === r.node)?.label || '?';
}

$('nav-all').onclick = () => {
  oceanField = '';
  enter('overview');
};
$('back').onclick = $('nav-all').onclick;
$('all-links').onclick = () => {
  showAllLinks = !showAllLinks;
  $('all-links').setAttribute('aria-pressed', showAllLinks);
  renderInspector();
  fit();
};
$('fit').onclick = () => {
  frameWholeOcean = true;
  fit();
};
$('zoom-in').onclick = () => zoom(1.25);
$('zoom-out').onclick = () => zoom(0.8);
function traceWorld(event) {
  const target = event.target.closest?.('[data-ref]');
  const ref = target ? JSON.parse(target.dataset.ref) : null;
  const id = scope === 'overview' && ref?.type === 'world' && !gesture ? ref.world : null;
  scene.classList.toggle('trace-world', Boolean(id));
  if (!id) return;
  for (const line of scene.querySelectorAll('[data-endpoints]')) {
    line.classList.toggle('trace-link', JSON.parse(line.dataset.endpoints).includes(id));
  }
}
svg.addEventListener('pointerover', traceWorld);
svg.addEventListener('focusin', traceWorld);
for (const event of ['pointerleave', 'focusout'])
  svg.addEventListener(event, () => scene.classList.remove('trace-world'));
svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
  },
  { passive: false },
);

svg.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const element = event.target;
  gesture = {
    start: { x: event.clientX, y: event.clientY },
    camera: { ...camera },
    moved: false,
    ref: element.closest('[data-ref]')?.dataset.ref,
    learningEdges: element.closest('[data-learning-edges]')?.dataset.learningEdges,
    edge: element.closest('[data-edge]')?.dataset.edge,
  };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove', (event) => {
  if (!gesture) return;
  const dx = event.clientX - gesture.start.x,
    dy = event.clientY - gesture.start.y;
  if (Math.hypot(dx, dy) > 4) gesture.moved = true;
  if (!gesture.moved) return;
  keepTopicCentered = false;
  svg.classList.add('dragging');
  camera.x = gesture.camera.x + dx;
  camera.y = gesture.camera.y + dy;
  renderCanvas();
});
svg.addEventListener('pointerup', () => {
  if (!gesture) return;
  const hit = gesture;
  gesture = null;
  svg.classList.remove('dragging');
  if (hit.moved) return;
  if (hit.ref) actionNode(JSON.parse(hit.ref));
  else if (hit.learningEdges) showLearningEdges(JSON.parse(hit.learningEdges));
  else if (hit.edge) select(JSON.parse(hit.edge));
  else if (scope === 'overview') select(null);
});
svg.addEventListener('pointercancel', () => {
  gesture = null;
  svg.classList.remove('dragging');
});
function topicHash(worldId, nodeId) {
  return '#topic/' + encodeURIComponent(worldId) + '/' + encodeURIComponent(nodeId);
}
function mapHash() {
  return selection?.type === 'node' && selection.world === scope
    ? topicHash(scope, selection.node)
    : scope === 'overview' && oceanField
      ? '#ocean/' + oceanField
      : '';
}
function replaceTopicAddress() {
  if (!navigationReady || $('olympiad').open) return;
  const fragment = mapHash();
  if (location.hash !== fragment)
    window.history.replaceState(null, '', location.pathname + location.search + fragment);
}
function centerOnTopic() {
  if (selection?.type !== 'node' || scope !== selection.world) return;
  const point = nodePos(scope, selection.node),
    rect = svg.getBoundingClientRect();
  const scale = Math.max(0.9, Math.min(1.2, rect.width / 460));
  camera = { k: scale, x: rect.width / 2 - point.x * scale, y: (rect.height - 32) / 2 - point.y * scale };
  renderCanvas();
}
function openTopic(worldId, nodeId) {
  const world = view(worldId);
  if (!world || worldId === 'overview' || !world.nodes.some((node) => node.id === nodeId)) return false;
  scope = worldId;
  selection = { type: 'node', world: worldId, node: nodeId };
  keepTopicCentered = true;
  render();
  centerOnTopic();
  const panel = inspector.closest('aside');
  panel.scrollTop = 0;
  if (matchMedia('(max-width:640px)').matches) inspector.scrollIntoView({ block: 'start' });
  return true;
}
function readTopicAddress() {
  const parts = location.hash.slice(1).split('/');
  if (parts[0] === 'olympiad') {
    renderOlympiad(Object.hasOwn(olympiadFields, parts[1]) ? parts[1] : '');
    if (!$('olympiad').open) $('olympiad').showModal();
    return;
  }
  if ($('olympiad').open) $('olympiad').close();
  if (parts[0] === 'ocean' && Object.hasOwn(olympiadFields, parts[1])) {
    oceanField = parts[1];
    enter('overview');
    return;
  }
  oceanField = '';
  if (parts[0] === 'topic' && parts.length === 3) {
    try {
      if (openTopic(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]))) return;
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
    toast('此知识点已移除或路径有误，可用“查找知识点”重新定位。');
  }
  enter('overview');
}
function atlasTopic(worldId, nodeId, label) {
  const node = view(worldId)?.nodes.find((item) => item.id === nodeId);
  return node ? html('a', { href: topicHash(worldId, nodeId) }, label || node.label) : null;
}

function appendTopicLinks(parent, entries) {
  for (const { world, node, label } of entries) {
    const link = atlasTopic(world, node, label);
    if (link) parent.append(link);
    else if (label) parent.append(html('span', {}, label + '（待补入口）'));
  }
}

function atlasLead(key) {
  const field = olympiadFields[key],
    reading = data.olympiadReading?.[key],
    steps = reading?.steps || [];
  const lead = html('section', { class: 'atlas-lead', 'aria-labelledby': 'atlas-reading-title' });
  const text = html('div', { class: 'atlas-lead-copy' });
  text.append(html('p', { class: 'atlas-subject' }, field.name + '选读'));
  const first = steps[0],
    topic = first && view(first.world)?.nodes.find((n) => n.id === first.node);
  text.append(
    html('h2', { id: 'atlas-reading-title' }, topic?.label || field.name),
    html('p', { class: 'atlas-question' }, reading?.question || field.question),
  );
  const path = html('div', { class: 'reading-path', 'aria-label': '阅读路线' });
  appendTopicLinks(path, steps);
  if (path.children.length) text.append(path);
  text.append(html('a', { class: 'ocean-link', href: '#ocean/' + key }, '展开' + field.name + '海图'));
  lead.append(text);
  const plate = $('plate-' + key);
  if (plate) lead.append(plate.content.cloneNode(true));
  return lead;
}

function atlasConnections(key, leadKey) {
  const relevant = data.olympiadReading?.[leadKey]?.steps || [];
  const matchesStep = (end) => relevant.some((s) => s.world === end.view && s.node === end.node);
  const edges = (data.crossEdges || []).filter((edge) => {
    const fields = [view(edge.source.view)?.olympiadField, view(edge.target.view)?.olympiadField];
    return (key ? fields.includes(key) : fields.some(Boolean)) && edge.why;
  });
  const insideRoute = (edge) => matchesStep(edge.source) && matchesStep(edge.target);
  const acrossFields = (edge) => {
    const a = view(edge.source.view)?.olympiadField,
      b = view(edge.target.view)?.olympiadField;
    return a && b && a !== b;
  };
  const first =
    edges.find((e) => !insideRoute(e) && (matchesStep(e.source) || matchesStep(e.target))) || edges[0];
  const second =
    edges.find((e) => e !== first && acrossFields(e)) || edges.find((e) => e !== first && !insideRoute(e));
  if (!first) return null;
  const group = html('section', { class: 'atlas-connections', 'aria-labelledby': 'connections-title' });
  group.append(html('h2', { id: 'connections-title' }, '沿着联系读'));
  const spread = html('div', { class: 'connection-spread' });
  for (const e of [first, second].filter(Boolean)) {
    const from = atlasTopic(e.source.view, e.source.node),
      to = atlasTopic(e.target.view, e.target.node);
    if (!from || !to) continue;
    const article = html('article', { class: 'connection-note' });
    article.append(html('small', {}, TYPES[e.kind]));
    const names = html('h3');
    names.append(from, html('span', { class: 'thread-link', 'aria-label': '连接到' }), to);
    article.append(names, html('p', {}, e.why));
    spread.append(article);
  }
  group.append(spread);
  return group;
}

function atlasFold(title, count) {
  const fold = html('details', { class: 'olympiad-section' }),
    summary = html('summary');
  summary.append(html('span', {}, title));
  if (count) summary.append(html('small', {}, count));
  fold.append(summary);
  return fold;
}

function atlasIndex(sections) {
  const block = html('section', { class: 'atlas-index', 'aria-labelledby': 'atlas-index-title' });
  const head = html('div', { class: 'index-heading' }),
    nodes = [];
  for (const section of sections) {
    section.nodes.forEach((node, order) =>
      nodes.push({ world: section.id, node: node.id, level: node.level, order }),
    );
  }
  // Interleave topics at the same teaching depth so neighboring links can enter different worlds.
  nodes.sort((a, b) => a.level - b.level || a.order - b.order);
  head.append(
    html('h2', { id: 'atlas-index-title' }, '知识索引'),
    html('small', {}, nodes.length + ' 个知识点'),
  );
  block.append(head);
  const start = html('div', { class: 'atlas-index-list' });
  appendTopicLinks(start, nodes.slice(0, 12));
  block.append(start);
  if (nodes.length > 12) {
    const more = atlasFold('展开其余 ' + (nodes.length - 12) + ' 个知识点');
    more.classList.add('index-more');
    const rest = html('div', { class: 'atlas-index-list' });
    appendTopicLinks(rest, nodes.slice(12));
    more.append(rest);
    block.append(more);
  }
  return block;
}

function atlasReferences(keys, sections) {
  const refs = html('section', { class: 'atlas-references', 'aria-labelledby': 'atlas-reference-title' });
  refs.append(html('h2', { id: 'atlas-reference-title' }, '查阅资料'));
  if (sections.length) {
    const notes = atlasFold('专题说明', sections.length + ' 个板块');
    for (const section of sections) {
      const sub = html('div', { class: 'index-note' });
      sub.append(html('h3', {}, worldTitle(section.id)));
      const introduction = overview().nodes.find((n) => n.target === section.id)?.entry;
      if (introduction) sub.append(html('p', {}, introduction));
      const links = html('div', { class: 'reference-links' });
      appendTopicLinks(
        links,
        section.nodes.map((n) => ({ world: section.id, node: n.id })),
      );
      sub.append(links);
      notes.append(sub);
    }
    refs.append(notes);
  }
  const benchmarks = keys.flatMap((k) => data.olympiadChecklist?.groups?.[k] || []);
  if (benchmarks.length) {
    const details = atlasFold('联赛加试大纲逐项索引', benchmarks.length + ' 项');
    details.append(html('p', {}, '按 2006 年修订试用稿编排，含当年列出的冬令营扩展。'));
    const links = html('div', { class: 'reference-links' });
    appendTopicLinks(links, benchmarks);
    details.append(links);
    refs.append(details);
  }
  const shortlist = (data.olympiadChecklist?.shortlist || []).filter((row) => keys.includes(row.field));
  if (shortlist.length) {
    const details = atlasFold('从 IMO 2024 候选题出发', shortlist.length + ' 道题');
    for (const row of shortlist) {
      const item = html('div', { class: 'shortlist-question' });
      item.append(html('h3', {}, row.number + ' · ' + row.title), html('p', {}, row.question));
      const link = atlasTopic(row.world, row.node);
      if (link) item.append(link);
      if (row.url?.startsWith('https://'))
        item.append(html('a', { href: row.url, target: '_blank', rel: 'noopener' }, '查看原题'));
      details.append(item);
    }
    refs.append(details);
  }
  const foundations = [...new Set(keys.flatMap((k) => olympiadFields[k].roots))].map(view).filter(Boolean);
  if (foundations.length) {
    const base = atlasFold('回看基础板块');
    const links = html('div', { class: 'reference-links' });
    for (const world of foundations)
      appendTopicLinks(
        links,
        world.nodes.map((n) => ({ world: world.id, node: n.id })),
      );
    base.append(links);
    refs.append(base);
  }
  return refs;
}

function renderOlympiad(key) {
  const keys = key ? [key] : Object.keys(olympiadFields);
  const sections = worlds().filter((v) => keys.includes(v.olympiadField));
  const tabs = $('olympiad-fields'),
    list = $('olympiad-directory');
  tabs.replaceChildren();
  list.replaceChildren();
  for (const id of ['', ...Object.keys(olympiadFields)]) {
    const name = id ? olympiadFields[id].name : '全部';
    const link = html('a', { href: id ? '#olympiad/' + id : '#olympiad' }, name);
    if (id === key) link.setAttribute('aria-current', 'page');
    tabs.append(link);
  }
  const leadKey = key || 'geometry';
  list.append(atlasLead(leadKey));
  const body = html('div', { class: 'atlas-body' }),
    connections = atlasConnections(key, leadKey);
  if (connections) body.append(connections);
  body.append(atlasIndex(sections), atlasReferences(keys, sections));
  list.append(body);
  $('olympiad').scrollTop = 0;
}
$('open-olympiad').onclick = () => {
  directoryReturn = location.hash;
  location.hash = 'olympiad';
};
function closeOlympiad() {
  $('olympiad').close();
  window.history.replaceState(null, '', location.pathname + location.search + directoryReturn);
  readTopicAddress();
}
$('close-olympiad').onclick = closeOlympiad;
$('olympiad').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeOlympiad();
});
function normalizeSearch(value) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}
function updateSearchResults() {
  const query = normalizeSearch($('topic-query').value),
    list = $('topic-results');
  list.replaceChildren();
  if (!query) {
    $('topic-match-count').textContent = '';
    return;
  }
  const matches = [];
  for (const world of worlds()) {
    for (const node of world.nodes) {
      const name = normalizeSearch(node.label);
      const aliases = Array.isArray(node.aliases)
        ? node.aliases.filter((a) => typeof a === 'string').map(normalizeSearch)
        : [];
      let rank;
      if (name === query) rank = 0;
      else if (aliases.includes(query)) rank = 1;
      else if (name.includes(query)) rank = 2;
      else if (aliases.some((alias) => alias.includes(query))) rank = 3;
      else if (
        query.length >= 2 &&
        typeof node.description === 'string' &&
        normalizeSearch(node.description).includes(query)
      )
        rank = 4;
      else continue;
      matches.push({ world, node, rank });
    }
  }
  matches.sort((a, b) => a.rank - b.rank);
  $('topic-match-count').textContent = matches.length
    ? `找到 ${matches.length} 个知识点`
    : '当前地图中没有匹配的知识点';
  for (const { world, node } of matches) {
    const li = html('li'),
      hash = topicHash(world.id, node.id),
      link = html('a', { href: hash });
    link.append(html('span', {}, node.label), html('small', {}, worldTitle(world.id)));
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      $('topic-search').close();
      if ($('olympiad').open) $('olympiad').close();
      if (location.hash !== hash) window.history.pushState(null, '', hash);
      openTopic(world.id, node.id);
    });
    li.append(link);
    list.append(li);
  }
}
$('open-search').onclick = () => {
  $('topic-query').value = '';
  updateSearchResults();
  $('topic-search').showModal();
  $('topic-query').focus();
};
$('atlas-search').onclick = () => $('open-search').click();
$('close-search').onclick = () => $('topic-search').close();
$('topic-query').addEventListener('input', updateSearchResults);
$('topic-search').addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  const links = [...$('topic-results').querySelectorAll('a')];
  if (!links.length) return;
  const index = links.indexOf(event.target);
  if (event.key === 'Enter' && event.target === $('topic-query')) {
    event.preventDefault();
    links[0].click();
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    links[Math.min(links.length - 1, index + 1)].focus();
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    (index <= 0 ? $('topic-query') : links[index - 1]).focus();
  }
});

window.addEventListener('hashchange', () => {
  if (navigationReady) readTopicAddress();
});

new ResizeObserver(() => {
  if (!data) return;
  if (keepTopicCentered && selection?.type === 'node' && scope === selection.world) centerOnTopic();
  else fit();
}).observe($('canvas'));

async function start() {
  try {
    const response = await fetch('content/map.json');
    if (!response.ok) throw new Error('无法读取教材地图');
    data = await response.json();
    navigationReady = true;
    $('open-search').disabled = false;
    $('open-olympiad').disabled = false;
    renderNav();
    fit();
    readTopicAddress();
  } catch (error) {
    inspector.replaceChildren(
      html('h2', {}, '暂时无法打开地图'),
      html('p', { class: 'intro' }, '请刷新页面，或从“教材正文”进入章节。'),
    );
    toast(error.message);
  }
}
start();
