'use strict';

window.LearningView = (() => {
  const ns = 'http://www.w3.org/2000/svg';
  const water = ['#f5f5e9', '#dfebe0', '#b6d5ca', '#416970'];
  const bandDefaults = ['海面', '浅海', '中层', '深海'];

  function svg(tag, attrs = {}, text) {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function widthInEm(text) {
    return Array.from(text || '', char => char.codePointAt(0) > 255 ? 1 : 0.57)
      .reduce((sum, width) => sum + width, 0);
  }

  function wrap(text, limit) {
    const lines = [];
    let line = '', width = 0;
    for (const char of text || '') {
      const next = widthInEm(char);
      if (line && width + next > limit) {
        lines.push(line.trim());
        line = '';
        width = 0;
      }
      line += char;
      width += next;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  // Keep neighbouring topics aligned while preserving each row's crossing-minimizing order.
  // Adjacent groups move together once the requested positions would make them overlap.
  function alignRow(row, points, neighbours, span) {
    const groups = [];
    for (const [i, vertex] of row.entries()) {
      const p = points.get(vertex.id);
      const adjacent = neighbours.get(vertex.id);
      const aim = adjacent.length ? adjacent.reduce((sum, id) => sum + points.get(id).x, 0) / adjacent.length : p.home;
      const group = {start:i, end:i, shift:(aim - p.home) * 0.83, size:1};
      while (groups.length && groups[groups.length - 1].shift > group.shift) {
        const last = groups.pop();
        group.shift = (last.shift * last.size + group.shift * group.size) / (last.size + group.size);
        group.size += last.size;
        group.start = last.start;
      }
      groups.push(group);
    }
    const last = points.get(row[row.length - 1].id);
    const slack = Math.max(0, span / 2 - (last.home + last.width / 2));
    for (const group of groups) {
      const shift = Math.min(slack, Math.max(-slack, group.shift));
      for (let i = group.start; i <= group.end; i++) {
        const p = points.get(row[i].id);
        p.x = p.home + shift;
      }
    }
  }

  function layout(view, graph, {overview = view.id === 'overview'} = {}) {
    const nodes = new Map(view.nodes.map(n => [n.id, n]));
    const ordinals = new Map(view.nodes.map((n, i) => [n.id, i + 1]));
    const points = new Map(), neighbours = new Map(), relayEdges = new Map();
    const gap = overview ? 18 : 20;
    const widestTitle = Math.max(0, ...view.nodes.map(n => widthInEm(n.label)));
    const extraLines = Math.max(0, Math.ceil(widestTitle / (overview ? 6.8 : 7.5)) - 2);
    const pitch = (overview ? 206 : 140) + extraLines * (overview ? 26 : 21);
    let widest = 0;
    graph.rows.forEach((row, i) => {
      let cursor = 0;
      for (const v of row) {
        const labelLength = widthInEm(nodes.get(v.nodeId)?.label);
        const width = v.kind === 'relay' ? (overview ? 44 : 36)
          : overview ? Math.max(153, Math.min(197, labelLength * 25 + 16))
            : Math.max(106, Math.min(172, labelLength * 22 + 15));
        points.set(v.id, {x:cursor + width / 2, y:i * pitch, width});
        neighbours.set(v.id, []);
        cursor += width + gap;
      }
      const span = Math.max(0, cursor - gap);
      widest = Math.max(widest, span);
      for (const v of row) {
        const p = points.get(v.id);
        p.x -= span / 2;
        p.home = p.x;
      }
    });
    for (const s of graph.segments) {
      neighbours.get(s.source).push(s.target);
      neighbours.get(s.target).push(s.source);
      for (const id of [s.source, s.target]) {
        if (graph.vertices.get(id).kind !== 'relay') continue;
        if (!relayEdges.has(id)) relayEdges.set(id, new Set());
        for (const index of s.edgeIndices) relayEdges.get(id).add(index);
      }
    }
    const rows = graph.rows.filter(row => row.length);
    for (let pass = 0; pass < 4; pass++) {
      for (const row of pass % 2 ? [...rows].reverse() : rows) alignRow(row, points, neighbours, widest);
    }
    const margin = overview ? 76 : 14;
    const left = -widest / 2 - margin, top = overview ? -86 : -47;
    const bounds = {x:left, y:top, w:Math.max(170, widest + margin + 18),
      h:Math.max(170, (graph.rows.length - 1) * pitch + (overview ? 144 : 90) + extraLines * 26 - top)};
    return {view, graph, nodes, ordinals, overview, bounds, pitch, points, relayEdges,
      position:id => points.get(id)};
  }

  function fit(map, rect, {opening = false} = {}) {
    const b = map.bounds, mobile = rect.width < 600;
    const margin = mobile ? 7 : 14, top = 12, bottom = mobile ? 64 : 52;
    const availableHeight = Math.max(48, rect.height - top - bottom);
    const k = Math.max(.012, Math.min((rect.width - 2 * margin) / b.w, availableHeight / b.h, 1.45));
    const readingScale = map.overview ? .54 : .65;
    if (opening && mobile && k < readingScale && map.graph.rows[0]?.length) {
      const row = map.graph.rows[0].map(v => map.position(v.id));
      const left = Math.min(...row.map(p => p.x - p.width / 2));
      const right = Math.max(...row.map(p => p.x + p.width / 2));
      const startK = Math.max(readingScale, Math.min(.9, (rect.width - 12) / (right - left + 15)));
      const rowWidth = (right - left) * startK;
      const x = rowWidth > rect.width && !map.overview ? 12 - left * startK : rect.width / 2 - (left + right) * startK / 2;
      return {k:startK, x, y:top - b.y * startK};
    }
    return {k, x:rect.width / 2 - (b.x + b.w / 2) * k,
      y:top + (availableHeight - b.h * k) / 2 - b.y * k};
  }

  function background(layer, map, settings) {
    const {camera:c, rect, data} = settings;
    const b = map.bounds;
    const x = Math.min(b.x, -c.x / c.k) - 6, y = Math.min(b.y, -c.y / c.k) - 6;
    const right = Math.max(b.x + b.w, (rect.width - c.x) / c.k) + 6;
    const bottom = Math.max(b.y + b.h, (rect.height - c.y) / c.k) + 6;
    const levels = map.graph.rowLevels || map.graph.rows.map(row =>
      Math.max(0, ...row.filter(v => v.kind === 'node').map(v => Number(map.nodes.get(v.id)?.level) || 0)));
    const bands = [...(data?.depthBands || [])].sort((a, b) => a.level - b.level);
    const academicLevels = [...new Set([...bands.map(band => band.level), ...levels])].sort((a,b) => a-b);
    const colorIndex = level => Math.round(3 * Math.max(0, academicLevels.indexOf(level)) / Math.max(1, academicLevels.length - 1));
    const deep = row => map.overview && colorIndex(levels[row]) === 3;

    if (!map.overview) return deep;
    const gradient = svg('linearGradient', {id:'learning-water', gradientUnits:'userSpaceOnUse',
      x1:0, x2:0, y1:0, y2:Math.max(1,(levels.length - 1) * map.pitch)});
    levels.forEach((level, i) => gradient.append(svg('stop', {
      offset:i / Math.max(1, levels.length - 1), 'stop-color':water[colorIndex(level)]})));
    if (!levels.length) gradient.append(svg('stop', {offset:0, 'stop-color':water[0]}));
    const defs = svg('defs');
    defs.append(gradient);
    layer.append(defs, svg('rect',{x, y, width:right-x, height:bottom-y, fill:'url(#learning-water)', 'pointer-events':'none'}));
    const seen = new Set();
    levels.forEach((level, i) => {
      if (seen.has(level)) return;
      seen.add(level);
      const single = map.graph.rows.length === 1;
      const band = bands.find(band => band.level === level);
      const label = band?.title || bandDefaults[level] || ('深度 ' + (level + 1));
      const rowY = i * map.pitch;
      const ink = deep(i) ? '#eef4e8' : '#32585c';
      const font = Math.min(25, Math.max(13, 10 / c.k));
      const labelX = Math.max(b.x + 6, x + 16 / c.k);
      const labelY = rowY - (single ? 56 : 62);
      const mark = svg('g',{class:'learning-depth', 'aria-hidden':'true', fill:ink});
      mark.append(svg('path',{d:'M' + labelX + ',' + labelY + ' h' + (font * .8), stroke:ink}),
        svg('text',{x:labelX + font, y:labelY + font * .34, 'font-size':font, class:'depth-label'},label));
      layer.append(mark);
    });
    return deep;
  }

  function titleText(g, lines, startY, fontSize, className) {
    const text = svg('text', {x:0, y:startY, 'font-size':fontSize, class:className, 'text-anchor':'middle'});
    lines.forEach((line, i) => text.append(svg('tspan',{x:0, dy:i ? fontSize * 1.12 : 0},line)));
    g.append(text);
  }

  function metrics(map, v, zoom) {
    if (v.kind === 'relay') return {top:7, bottom:7};
    const node = map.nodes.get(v.id), width = map.position(v.id).width;
    const name = node?.label || '';
    const radius = map.overview ? 45 : 17;
    const font = map.overview ? Math.min(26, Math.max(16, 12.8 / zoom)) : Math.min(22, Math.max(15, 12.0 / zoom));
    const lines = wrap(name, Math.max(3, (width - 8) / font));
    const labelY = radius + (map.overview ? 11 : 9) + font * .84;
    const labelBottom = labelY + Math.max(0, lines.length - 1) * font * 1.12 + font * .25;
    const hasEntry = map.overview && node.entry && (v.row === 0 || (zoom >= .65 && lines.length === 1));
    const entryFont = Math.min(19, Math.max(13, 10.3 / zoom));
    const entryLines = hasEntry ? wrap(node.entry, (width - 4) / entryFont) : [];
    const entry = entryLines.slice(0, 2);
    if (entryLines.length > 2) entry[1] = entry[1].slice(0, -1) + '…';
    if (entry.length === 2 && node.entry.includes('·')) {
      const parts = node.entry.split('·').map(part=>part.trim());
      const limit = (width - 4) / entryFont;
      const split = parts.findIndex((_, i)=>i > 0 &&
        widthInEm(parts.slice(0,i).join(' · ')) <= limit && widthInEm(parts.slice(i).join(' · ')) <= limit);
      if (split > 0) entry.splice(0, 2, parts.slice(0,split).join(' · '), parts.slice(split).join(' · '));
    }
    const entryY = labelBottom + entryFont * .93;
    return {top:radius, bottom:entry.length ? entryY + ((entry.length - 1) * 1.12 + .23) * entryFont : labelBottom,
      radius, font, labelY, lines, entry, entryY, entryFont};
  }

  function worldRoutes(map, zoom, edges = map.view.edges) {
    const chapters = new Map(map.view.nodes.map(n => {
      const p = map.position(n.id), m = metrics(map,map.graph.vertices.get(n.id),zoom);
      const width = Math.max(...m.lines.map(s => widthInEm(s)*m.font), ...m.entry.map(s => widthInEm(s)*m.entryFont), 0);
      return [n.id,{...p, radius:m.radius+6, labelWidth:width,
        labelTop:m.labelY-m.font*.88, labelBottom:m.bottom}];
    }));
    return window.OceanMap.chapterRoutes(edges,chapters);
  }

  function describe(map, indices) {
    return indices.map(i => {
      const e = map.view.edges[i];
      return (map.nodes.get(e.source)?.label || e.source) + ' → ' +
        (map.nodes.get(e.target)?.label || e.target) + (e.label ? '（' + e.label + '）' : '');
    }).join('、');
  }

  function attachEdge(g, indices, name, settings) {
    g.setAttribute('data-learning-edges', JSON.stringify(indices));
    g.setAttribute('role','button');
    g.setAttribute('tabindex','0');
    g.setAttribute('aria-label',name);
    g.append(svg('title', {}, name));
    g.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      settings.onEdge?.(indices);
    });
    // Touch and mouse are handled by the map's pan gesture. Assistive
    // technology can also activate a button with a discrete click.
    g.addEventListener('click', event => {
      if (event.detail === 0) settings.onEdge?.(indices);
    });
  }

  function segment(layer, map, s, sizes, clearances, isDeep, settings) {
    const a = map.position(s.source), b = map.position(s.target);
    const from = map.graph.vertices.get(s.source), to = map.graph.vertices.get(s.target);
    const dx = b.x - a.x;
    const ax = a.x, ay = a.y + sizes.get(from.id).bottom + 5;
    const port = to.kind === 'relay' ? 0 : Math.sign(dx) * Math.min(map.overview ? 20 : 8, Math.abs(dx) * .12);
    const radius = sizes.get(to.id).top;
    const bx = b.x - port, by = b.y - Math.sqrt(radius * radius - port * port) - 5;
    // Shift sideways only in the open strip between rows, clear of every label and orbit.
    const start = Math.max(ay, a.y + clearances[from.row].bottom + 5);
    const end = Math.min(by, b.y - clearances[to.row].top - 5);
    const bend = (end - start) * .42;
    const d = 'M' + ax + ',' + ay + ' V' + start + ' C' + ax + ',' + (start+bend) + ' ' +
      bx + ',' + (end-bend) + ' ' + bx + ',' + end + ' V' + by;
    const endpoints = new Set();
    for (const index of s.edgeIndices) {
      const e = map.view.edges[index];
      for (const id of [e.source,e.target]) endpoints.add(map.nodes.get(id)?.target || id);
    }
    const muted = settings.edgeIsRelated && !s.edgeIndices.some(settings.edgeIsRelated);
    const g = svg('g',{class:'learning-segment' + (muted ? ' learning-muted' : ''), 'data-endpoints':JSON.stringify([...endpoints]),
      'data-from-row':from.row, 'data-to-row':to.row,
      style:'--flow-ink:' + (isDeep(from.row) && isDeep(to.row) ? '#d9e8dd' : '#3d6d6c')});
    const selected = s.edgeIndices.some(index => settings.edgeIsSelected?.(index));
    g.append(svg('path',{d, class:'edge ' + s.kind + (selected ? ' selected' : ''), 'aria-hidden':'true'}));
    const hit = svg('path',{d, class:'edge-hit'});
    attachEdge(hit, s.edgeIndices, describe(map, s.edgeIndices), settings);
    g.append(hit);
    layer.append(g);
  }

  function relay(layer, map, vertex, p, deep, settings) {
    const indices = [...(map.relayEdges.get(vertex.id) || [])];
    const name = map.nodes.get(vertex.nodeId)?.label || vertex.nodeId;
    const muted = settings.edgeIsRelated && !indices.some(settings.edgeIsRelated);
    const g = svg('g',{transform:'translate('+p.x+' '+p.y+')', class:'learning-relay' + (deep ? ' deep' : '') + (muted ? ' learning-muted' : ''),
      'data-source-id':vertex.nodeId, 'data-row':vertex.row});
    attachEdge(g,indices,'续接「' + name + '」的联系。' + describe(map, indices),settings);
    const r = 6.8;
    g.append(svg('circle',{r:16, fill:'transparent'}),
      svg('path',{d:'M0,'+(-r)+' L'+r+',0 0,'+r+' '+(-r)+',0 Z',class:'relay-diamond'}));
    const font = 11.5 / settings.camera.k;
    const pieces = wrap(name, Math.max(5, settings.rect.width / 11.5 - 7));
    const label = '来自「' + pieces[0] + (pieces.length > 1 ? '…' : '') + '」';
    const badgeWidth = (widthInEm(label) + 1.1) * font;
    const xRight = (settings.rect.width - settings.camera.x) / settings.camera.k - p.x;
    const xLeft = -settings.camera.x / settings.camera.k - p.x;
    const badgeX = Math.max(xLeft + 3, Math.min(r + 4, xRight - badgeWidth - 3));
    const badge = svg('g',{class:'relay-source', 'aria-hidden':'true',
      transform:'translate(' + badgeX + ' ' + (-r - 4) + ')'});
    badge.append(svg('rect',{x:0, y:-font*1.08, width:badgeWidth, height:font*1.55, rx:font*.35}),
      svg('text',{x:font*.55, y:0, 'font-size':font},label));
    g.append(badge);
    function trace(event) {
      const on = event.type === 'pointerenter' || event.type === 'focusin';
      layer.classList.toggle('relay-traced', on);
      if (!on) return;
      for (const line of layer.querySelectorAll('.learning-segment')) {
        const edgeIds = JSON.parse(line.querySelector('.edge-hit').dataset.learningEdges);
        line.classList.toggle('relay-trace-match', edgeIds.some(i=>indices.includes(i)));
      }
    }
    for (const event of ['pointerenter','pointerleave','focusin','focusout']) g.addEventListener(event, trace);
    layer.append(g);
  }

  function drawWorld(layer, map, vertex, p, m, deep, settings, worlds) {
    const node = map.nodes.get(vertex.id);
    const id = node.target || node.id, world = worlds.get(id);
    const title = settings.worldTitle?.(id) || node.label;
    const color = settings.color?.(id) || '#527d73';
    const group = svg('g',{class:'learning-world ocean-world' + (deep ? ' deep' : ''), 'data-row':vertex.row,
      'data-id':vertex.id, 'data-world':id, transform:'translate('+p.x+' '+p.y+')', style:'--world:'+color});
    group.append(svg('circle',{r:m.radius, class:'world-ring'}));
    group.append(svg('circle',{r:m.radius, fill:'transparent', 'aria-hidden':'true',
      'data-ref':JSON.stringify({type:'world',world:id})}));
    const core = svg('g',{class:'world-core learning-world-control'});
    const children = world?.nodes || [];
    const countFont = Math.min(29,Math.max(19,11/settings.camera.k));
    core.append(svg('title',{},[title,node.entry].filter(Boolean).join(' · ')), svg('circle',{r:26}),
      svg('text',{x:0, y:countFont*.34, 'text-anchor':'middle','font-size':countFont, class:'world-count'},String(children.length)));
    const ref = {type:'world',world:id};
    settings.interactive(core,ref,'展开板块 '+title);
    const caption = svg('g',{class:'ocean-captions','data-ref':JSON.stringify(ref), 'aria-hidden':'true'});
    titleText(caption, m.lines, m.labelY, m.font, 'world-label');
    if (m.entry.length) titleText(caption, m.entry, m.entryY, m.entryFont, 'ocean-entry');
    group.append(core,caption);

    children.forEach((child, i) => {
      const angle = i * Math.PI * 2 / children.length - Math.PI / 2;
      const x = Math.cos(angle) * m.radius, y = Math.sin(angle) * m.radius;
      const active = settings.selection?.type === 'node' && settings.selection.world === id && settings.selection.node === child.id;
      const satellite = svg('g',{transform:'translate('+x+' '+y+')',class:'knowledge-node learning-satellite'+(active?' selected':'')});
      const radius = Math.max(2.4, Math.min(5.1, Math.PI * m.radius / children.length * .76));
      satellite.append(svg('title',{},title+' · '+child.label),
        svg('circle',{r:Math.max(7, radius * 1.6),fill:'transparent'}),
        svg('circle',{r:radius,class:'satellite'}));
      settings.interactive(satellite,{type:'node',world:id,node:child.id},'查看 '+child.label);
      group.append(satellite);
    });
    layer.append(group);
  }

  function drawTopic(layer, map, vertex, p, m, settings) {
    const n = map.nodes.get(vertex.id), scope = settings.scope || map.view.id;
    const active = settings.selection?.type === 'node' && settings.selection.world === scope && settings.selection.node === n.id;
    const muted = settings.nodeIsRelated && !settings.nodeIsRelated(n.id);
    const g = svg('g',{class:'learning-topic knowledge-node'+(active?' selected':'') + (muted ? ' learning-muted' : ''), 'data-id':vertex.id, 'data-row':vertex.row,
      transform:'translate('+p.x+' '+p.y+')', style:'--world:'+(settings.color?.(scope) || '#44776e')});
    g.append(svg('title',{},n.label), svg('circle',{r:m.radius,class:'satellite'}),
      svg('text',{x:0, y:5, 'font-size':14, class:'node-number'},String(map.ordinals.get(n.id))));
    titleText(g,m.lines,m.labelY,m.font,'node-label');
    settings.interactive(g,{type:'node',world:scope,node:n.id},'知识点 '+n.label);
    layer.append(g);
  }

  function render(scene, map, settings) {
    const {camera, data} = settings;
    const layer = svg('g',{class:'learning-map ' + (map.overview ? 'learning-ocean' : 'learning-detail')});
    scene.replaceChildren(layer);
    scene.setAttribute('transform','translate('+camera.x+','+camera.y+') scale('+camera.k+')');
    const isDeep = background(layer,map,settings);
    const sizes = new Map();
    for (const v of map.graph.vertices.values()) sizes.set(v.id, metrics(map,v,camera.k));
    const clearances = map.graph.rows.map(row => ({
      top:Math.max(0,...row.map(v=>sizes.get(v.id).top)), bottom:Math.max(0,...row.map(v=>sizes.get(v.id).bottom))}));
    for (const s of map.graph.segments) segment(layer,map,s,sizes,clearances,isDeep,settings);
    const worlds = new Map((data?.views || []).map(view => [view.id, view]));
    for (const v of map.graph.vertices.values()) {
      if (v.kind === 'relay') continue;
      const p = map.position(v.id), m = sizes.get(v.id);
      if (map.overview) drawWorld(layer,map,v,p,m,isDeep(v.row),settings,worlds);
      else drawTopic(layer,map,v,p,m,settings);
    }
    for (const id of map.relayEdges.keys()) {
      const v = map.graph.vertices.get(id);
      relay(layer,map,v,map.position(id),isDeep(v.row),settings);
    }
  }

  return {layout, fit, render, worldRoutes};
})();
