'use strict';

// The links are an ordinary chapter directory even without the diagram.
(() => {
  const nav = document.querySelector('#chapter-outline');
  if (!nav || !window.LearningGraph) return;
  const list = nav.querySelector('.outline-topics');
  const items = new Map([...list.children].map(item => [item.dataset.topic, item]));
  if (!items.size) return;
  const nodes = [...items].map(([id, item]) => ({id, level: Number(item.dataset.level)}));
  const edges = JSON.parse(nav.querySelector('.outline-edges').textContent);
  const graph = LearningGraph.build({nodes, edges}, {maxPerRow: 1});
  const order = graph.rows.flat().filter(vertex => vertex.kind === 'node').map(vertex => vertex.id);
  const rank = new Map(order.map((id, index) => [id, index]));
  const names = new Map([...items].map(([id, item]) => [id, item.querySelector('a').textContent.trim()]));
  const selected = list.querySelector('[aria-current="page"]')?.closest('li').dataset.topic;
  const relates = (edge, id) => edge.source === id || edge.target === id;

  function connectionText(edge, id) {
    const incoming = edge.target === id;
    const other = names.get(incoming ? edge.source : edge.target);
    const type = edge.kind === 'perspective' ? '理解联系'
      : edge.kind === 'prerequisite' ? (incoming ? '必要前置' : '用在') : (incoming ? '承接' : '可接着读');
    return type + '「' + other + '」' + (edge.label ? ' · ' + edge.label : '');
  }
  for (const id of order) {
    const item = items.get(id);
    const link = item.querySelector('a');
    const connections = edges.filter(edge => relates(edge, id)).map(edge => connectionText(edge, id));
    if (item.classList.contains('outline-pending')) connections.unshift('正文待写');
    link.title = [names.get(id), ...connections].join('\n');
    if (connections.length) link.setAttribute('aria-description', connections.join('。'));
    list.append(item);
  }

  // Long connections bend away from the topic dots. Connections leaving the
  // same topic on the same kind of path can share a stem until they diverge.
  const shown = new Set([...graph.kept, ...graph.feedback, ...graph.perspectives.filter(i => relates(edges[i], selected))]);
  const groups = new Map();
  const branches = new Map();
  for (const i of shown) {
    const edge = edges[i], start = rank.get(edge.source), end = rank.get(edge.target);
    if (Math.abs(end - start) === 1 && edge.kind !== 'perspective') continue;
    const key = JSON.stringify([edge.source, edge.kind, Math.sign(end - start)]);
    if (!groups.has(key)) groups.set(key, {from: start, to: start});
    const group = groups.get(key);
    group.from = Math.min(group.from, end);
    group.to = Math.max(group.to, end);
    branches.set(i, group);
  }
  const laneEnds = [];
  for (const group of [...groups.values()].sort((a,b) => a.from - b.from || a.to - b.to)) {
    let lane = laneEnds.findIndex(end => end <= group.from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = group.to;
    group.lane = lane;
  }

  function svg(tag, attrs) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    return element;
  }
  const plot = document.createElement('div');
  plot.className = 'outline-plot';
  list.before(plot);
  const linework = svg('svg', {class: 'outline-linework', 'aria-hidden': 'true', focusable: 'false'});
  plot.append(list, linework);
  const paths = new Map();
  // Draw active connections last so they remain visible over a shared stem.
  const paintOrder = [...shown].sort((a,b) => Number(relates(edges[a], selected)) - Number(relates(edges[b], selected)));
  for (const i of paintOrder) {
    const edge = edges[i];
    const path = svg('path', {class: 'outline-edge ' + edge.kind + (relates(edge, selected) ? ' is-current' : '')});
    linework.append(path);
    paths.set(i, path);
  }
  const dots = new Map();
  for (const id of order) {
    const pending = items.get(id).classList.contains('outline-pending');
    const dot = svg('circle', {r: id === selected ? 5 : 3.4,
      class: 'outline-dot' + (pending ? ' is-pending' : '') + (id === selected ? ' is-current' : '')});
    linework.append(dot);
    dots.set(id, dot);
  }

  function position() {
    const width = linework.getBoundingClientRect().width;
    if (!width) return;
    const top = plot.getBoundingClientRect().top;
    const dotX = width - (width < 36 ? 6 : 10);
    const leftMargin = width < 36 ? 2 : 5;
    const y = new Map();
    for (const [id, dot] of dots) {
      const row = items.get(id).getBoundingClientRect();
      const center = row.top - top + row.height / 2;
      y.set(id, center);
      dot.setAttribute('cx', dotX);
      dot.setAttribute('cy', center);
    }
    for (const [i, path] of paths) {
      const edge = edges[i], start = y.get(edge.source), end = y.get(edge.target);
      const branch = branches.get(i);
      let d = 'M ' + dotX + ' ' + start;
      if (branch) {
        const x = dotX - 3 - (dotX - leftMargin - 3) * (branch.lane + 1) / laneEnds.length;
        const bend = Math.min(12, Math.abs(end - start) / 4) * Math.sign(end - start);
        d += ' Q ' + x + ' ' + start + ' ' + x + ' ' + (start + bend);
        d += ' V ' + (end - bend) + ' Q ' + x + ' ' + end + ' ' + dotX + ' ' + end;
      } else d += ' V ' + end;
      path.setAttribute('d', d);
    }
  }
  position();
  nav.dispatchEvent(new Event('outline-layout'));
  new ResizeObserver(position).observe(plot);
})();
