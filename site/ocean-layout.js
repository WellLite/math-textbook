'use strict';

// The overview's vertical axis represents curriculum depth. Coordinates use the same
// SVG space as the map, so panning, saved positions and the detailed views agree.
window.OceanMap = (() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const rowHeight = 310;
  const columnWidth = 318;
  const orbitRadius = 70;
  const defaultTitles = ['海面', '浅海', '中层', '深海'];
  const stops = [
    [0, '#f5f6ec', '#ebf1e7'],
    [0.34, '#deebdf', '#cddfd3'],
    [0.67, '#b1d2c8', '#9bbfb9'],
    [1, '#426c73', '#305763'],
  ];

  function svgNode(tag, attrs = {}, value) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, attr] of Object.entries(attrs)) node.setAttribute(key, attr);
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function overviewNodes(data) {
    return data.views.find(view => view.id === 'overview')?.nodes || [];
  }

  function bands(data) {
    const configured = Array.isArray(data.depthBands) ? data.depthBands : [];
    const byLevel = new Map(configured.map(band => [band.level, band]));
    for (const node of overviewNodes(data)) {
      if (!byLevel.has(node.level)) {
        byLevel.set(node.level, {level: node.level, title: defaultTitles[node.level] || `深度 ${node.level + 1}`});
      }
    }
    return [...byLevel.values()].sort((left, right) => left.level - right.level);
  }

  function rowsAt(data, level) {
    const count = overviewNodes(data).filter(node => node.level === level).length;
    return Math.max(1, Math.ceil(count / 5));
  }

  function rowY(data, level) {
    return bands(data).filter(band => band.level < level)
      .reduce((height, band) => height + rowsAt(data, band.level) * rowHeight, 0);
  }

  function nearestRow(data, y) {
    const rows = bands(data).flatMap(band => Array.from({length:rowsAt(data,band.level)},
      (_,i) => ({level:band.level, y:rowY(data,band.level) + i * rowHeight})));
    return rows.reduce((a,b) => Math.abs(y - a.y) <= Math.abs(y - b.y) ? a : b);
  }

  function position(data, worldId) {
    const manual = data.layout?.worlds?.[worldId];
    if (manual && Number.isFinite(manual.x) && Number.isFinite(manual.y)) return {...manual};
    const nodes = overviewNodes(data);
    const node = nodes.find(item => item.target === worldId);
    if (!node) return {x: 0, y: 0};
    const peers = nodes.filter(item => item.level === node.level);
    const rowCount = rowsAt(data, node.level);
    const index = peers.indexOf(node);
    const row = Math.floor(index * rowCount / peers.length);
    const first = Math.ceil(row * peers.length / rowCount);
    const last = Math.ceil((row + 1) * peers.length / rowCount);
    const column = index - first;
    const baseline = rowY(data,node.level) + row * rowHeight;
    // A small drift keeps neighbouring orbits distinct while their depth stays unambiguous.
    const phase = column * 1.94 + baseline / rowHeight * 1.37;
    const drift = Math.sin(baseline / rowHeight * 2.41 + .3) * (last-first === 1 ? 42 : 75);
    const x = (column - (last - first - 1) / 2) * columnWidth;
    return {x:x + drift + Math.sin(phase + .45) * 23, y:baseline + Math.sin(phase) * 25};
  }

  function bounds(data) {
    const points = overviewNodes(data).map(node => position(data, node.target));
    const vertical = bands(data).map(band => rowY(data, band.level));
    const minX = Math.min(0, ...points.map(p => p.x)) - 136;
    const maxX = Math.max(0, ...points.map(p => p.x)) + 136;
    const top = Math.min(0, ...vertical, ...points.map(p => p.y)) - 134;
    const bottom = Math.max(0, ...vertical, ...points.map(p => p.y)) + 176;
    const labelGutter = 140;
    return {x: minX - labelGutter, y: top, w: maxX - minX + labelGutter, h: bottom - top};
  }

  function fit(data, rect) {
    const box = bounds(data);
    const margin = rect.width < 600 ? 7 : 20;
    const top = 26, bottom = rect.width < 600 ? 62 : 51;
    const k = Math.max(0.02, Math.min((rect.width - margin * 2) / box.w, (rect.height - top - bottom) / box.h, 1.45));
    return {k, x: rect.width / 2 - (box.x + box.w / 2) * k, y: top + (rect.height - top - bottom - box.h * k) / 2 - box.y * k};
  }

  function opening(data, rect) {
    const fitted = fit(data,rect);
    const worlds = overviewNodes(data);
    if(rect.width >= 600 || worlds.length <= 10 || fitted.k >= .32) return fitted;
    // Enter a dense atlas at its surface. The explicit fit control still frames every orbit.
    const shallowest = Math.min(...worlds.map(n => n.level));
    const points = worlds.filter(n => n.level === shallowest).map(n => position(data,n.target));
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y));
    const scale = Math.max(.34,Math.min(.56,(rect.width-42)/(right-left+200)));
    return {k:scale,x:rect.width/2 + 8 - ((left+right)/2)*scale,y:52+(orbitRadius-top)*scale};
  }

  function satelliteOffset(index, total) {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / Math.max(total, 1);
    return {x: orbitRadius * Math.cos(angle), y: orbitRadius * Math.sin(angle)};
  }

  function satellite(data, worldId, nodeId) {
    const center = position(data, worldId);
    const nodes = data.views.find(view => view.id === worldId)?.nodes || [];
    const offset = satelliteOffset(nodes.findIndex(node => node.id === nodeId), nodes.length);
    return {x: center.x + offset.x, y: center.y + offset.y};
  }

  function palette(index, total) {
    const fraction = total > 1 ? index / (total - 1) : 0;
    const upper = stops.findIndex(stop => stop[0] >= fraction);
    const end = stops[Math.max(0, upper)];
    const start = stops[Math.max(0, upper - 1)];
    const mix = end[0] === start[0] ? 0 : (fraction - start[0]) / (end[0] - start[0]);
    const blend = (a,b) => {
      const channels = [1,3,5].map(offset => {
        const first = parseInt(a.slice(offset, offset+2),16), second = parseInt(b.slice(offset, offset+2),16);
        return Math.round(first + (second-first)*mix).toString(16).padStart(2,'0');
      });
      return '#' + channels.join('');
    };
    const top = blend(start[1],end[1]), bottom = blend(start[2],end[2]);
    const deep = fraction >= .90;
    return {top,bottom,ink:deep?'#fffdf3':'#183e43',muted:deep?'#e5f2ea':'#345658'};
  }

  // One continuous gradient follows the actual rows, including levels with several rows.
  function background(data, camera, rect) {
    const layers = bands(data);
    const group = svgNode('g',{class:'ocean-water','pointer-events':'none','aria-hidden':'true'});
    if (!layers.length) return group;
    const box = bounds(data);
    const left = Math.min(box.x, -camera.x / camera.k) - 12;
    const right = Math.max(box.x + box.w, (rect.width - camera.x) / camera.k) + 12;
    const top = Math.min(box.y, -camera.y / camera.k) - 12;
    const bottom = Math.max(box.y + box.h, (rect.height - camera.y) / camera.k) + 12;
    const first = rowY(data,layers[0].level) - 125;
    const lastLevel = layers[layers.length-1].level;
    const last = rowY(data,lastLevel) + (rowsAt(data,lastLevel)-1) * rowHeight + 148;
    const gradient = svgNode('linearGradient',{id:'atlas-depth',gradientUnits:'userSpaceOnUse',x1:0,x2:0,y1:first,y2:last});
    const routeInk = svgNode('linearGradient',{id:'atlas-route-ink',gradientUnits:'userSpaceOnUse',x1:0,x2:0,y1:first,y2:last});
    const defs = svgNode('defs');
    defs.append(gradient,routeInk);
    group.append(defs,svgNode('rect',{x:left,y:top,width:right-left,height:bottom-top,fill:'url(#atlas-depth)'}));
    gradient.append(svgNode('stop',{offset:0,'stop-color':'#f8f8ef'}));
    layers.forEach((band,index) => {
      const y = rowY(data,band.level), colours = palette(index,layers.length);
      const rows = rowsAt(data,band.level);
      const start = (y - 13 - first) / (last-first);
      const end = (y + (rows-1)*rowHeight + 13 - first) / (last-first);
      const lineInk = colours.ink === '#fffdf3' ? '#d1e3dc' : '#436765';
      gradient.append(svgNode('stop',{offset:start,'stop-color':colours.top}));
      if(rows>1)gradient.append(svgNode('stop',{offset:end,'stop-color':colours.bottom}));
      routeInk.append(svgNode('stop',{offset:start,'stop-color':lineInk}),svgNode('stop',{offset:end,'stop-color':lineInk}));
    });
    gradient.append(svgNode('stop',{offset:1,'stop-color':palette(layers.length-1,layers.length).bottom}));

    // Light, off-centre bathymetric contours are independent of the editable relationship paths.
    for(const [side,anchorY,scale] of [[-1,first + (last-first)*.14,.92],[1,first + (last-first)*.81,1.24]]){
      const edgeX = side===-1 ? box.x : box.x+box.w;
      const contour = svgNode('g',{class:'ocean-contours',transform:`translate(${edgeX} ${anchorY}) scale(${-side*scale} ${scale})`});
      for(let i=0;i<5;i++){
        const inset = i*28;
        contour.append(svgNode('path',{class:'ocean-contour',d:`M ${-300+inset} -280 C ${150+inset} -135, ${-122+inset} -72, ${60+inset} -10 S ${180+inset} 60, ${112+inset} 150 S ${162+inset} 260, ${-200+inset} 380`}));
      }
      group.append(contour);
    }
    const gutter = rect.width < 600 ? Math.max(box.x+14,(8-camera.x)/camera.k) : box.x+14;
    const textScale = Math.min(1,camera.k);
    const titleSize = Math.max(23,(rect.width<600 ? 12.5 : 15.5) / textScale);
    const smallSize = Math.max(16,(rect.width<600 ? 9.5 : 11) / textScale);
    layers.forEach((band,index)=>{
      const y = rowY(data,band.level), colours = palette(index,layers.length);
      group.append(svgNode('line',{x1:gutter,y1:y-20,x2:gutter+30,y2:y-20,stroke:colours.ink,class:'ocean-tick'}));
      group.append(svgNode('text',{x:gutter,y:y+titleSize*.72,'font-size':titleSize,fill:colours.ink,class:'depth-label'},band.title));
      if(band.subtitle) group.append(svgNode('text',{x:gutter,y:y+titleSize*.72+smallSize*1.50,'font-size':smallSize,fill:colours.muted,class:'depth-caption'},band.subtitle));
    });
    return group;
  }

  function textSizes(zoom) {
    return {
      title: Math.max(22,(zoom<.30?10.5:13.5)/zoom),
      subtitle: Math.max(16,(zoom<.30?8.8:10.7)/zoom),
    };
  }

  // A clear segment between two visibility-graph vertices may follow a box
  // boundary. Only an intersection with its interior blocks the segment.
  function cutsBox(a, b, box) {
    const dx = b.x-a.x, dy = b.y-a.y;
    let enter = 0, leave = 1;
    if (dx !== 0) {
      const near = ((dx > 0 ? box.left : box.right) - a.x) / dx;
      const far = ((dx > 0 ? box.right : box.left) - a.x) / dx;
      if (near > enter) enter = near;
      if (far < leave) leave = far;
    }
    if (dy !== 0) {
      const near = ((dy > 0 ? box.top : box.bottom) - a.y) / dy;
      const far = ((dy > 0 ? box.bottom : box.top) - a.y) / dy;
      if (near > enter) enter = near;
      if (far < leave) leave = far;
    }
    return enter < leave - 1e-8;
  }

  function approach(from, toward, distance) {
    const fraction = distance / (Math.hypot(toward.x - from.x, toward.y - from.y) || 1);
    return {x:from.x + (toward.x - from.x) * fraction, y:from.y + (toward.y - from.y) * fraction};
  }

  function routePath(points, start, end, paired) {
    const dx = end.x - start.x, dy = end.y - start.y, span = Math.hypot(dx, dy);
    if (!span) return '';
    // Opposite directions occupy different sides of the same corridor.
    const shift = paired ? Math.min(6, start.radius / 10, end.radius / 10) : 0;
    const path = points.map(p => ({x:p.x - shift * dy / span, y:p.y + shift * dx / span}));
    function dock(center, index, next) {
      const a = path[index], b = path[next], length = Math.hypot(b.x-a.x, b.y-a.y) || 1;
      const x = a.x-center.x, y = a.y-center.y;
      const dot = (x*(b.x-a.x) + y*(b.y-a.y)) / length;
      const radial = Math.sqrt(Math.max(0, center.radius**2 - x*x - y*y + dot*dot)) - dot;
      return approach(a, b, Math.min(radial, length));
    }
    const last = path.length - 1;
    const a = dock(start, 0, 1), b = dock(end, last, last-1);
    path[0] = a; path[last] = b;
    const coord = p => p.x.toFixed(2) + ',' + p.y.toFixed(2);
    let d = 'M' + coord(a);
    for (let i=1; i<last; i++) {
      const prev = path[i-1], p = path[i], next = path[i+1];
      const round = Math.min(12, Math.hypot(prev.x-p.x,prev.y-p.y)/3, Math.hypot(next.x-p.x,next.y-p.y)/3);
      d += ' L' + coord(approach(p, prev, round)) + ' Q' + coord(p) + ' ' + coord(approach(p, next, round));
    }
    return d + ' L' + coord(b);
  }

  // Shortest visible paths use local corners only when an intervening orbit or
  // caption obstructs the direct line. World centers are terminals, never relays.
  function routePlanner(chapters) {
    const boxes = [], points = [], centers = new Map();
    for (const [id, p] of chapters) {
      centers.set(id, points.length);
      points.push({...p, id});
      boxes.push({owner:id, left:p.x-p.radius-8, right:p.x+p.radius+8,
        top:p.y-p.radius-8, bottom:p.y+p.radius+8});
      boxes.push({left:p.x-p.labelWidth/2-7, right:p.x+p.labelWidth/2+7,
        top:p.y+p.labelTop-4, bottom:p.y+p.labelBottom+7});
    }
    for (const b of boxes) {
      for (const x of [b.left,b.right]) for (const y of [b.top,b.bottom]) points.push({x,y});
    }
    const graph = points.map(() => []);
    for (let i=0; i<points.length; i++) {
      const a = points[i];
      for (let j=0; j<i; j++) {
        const b = points[j];
        const left = Math.min(a.x,b.x), right = Math.max(a.x,b.x);
        const top = Math.min(a.y,b.y), bottom = Math.max(a.y,b.y);
        if (boxes.some(box => left < box.right && right > box.left && top < box.bottom && bottom > box.top &&
          !(box.owner && (box.owner === a.id || box.owner === b.id)) && cutsBox(a,b,box))) continue;
        const weight = Math.hypot(a.x-b.x, a.y-b.y);
        if (!weight) continue;
        graph[i].push({index:j, weight});
        graph[j].push({index:i, weight});
      }
    }
    function pathsFrom(source) {
      const from = centers.get(source);
      const previous = Array(points.length).fill(-1), dist = Array(points.length).fill(Infinity);
      const visited = Array(points.length).fill(false);
      dist[from] = 0;
      while (true) {
        let index = -1, min = Infinity;
        for (let i=0; i<points.length; i++) {
          if (!visited[i] && dist[i] < min) {index = i; min = dist[i];}
        }
        if (index === -1) break;
        visited[index] = true;
        if (index !== from && points[index].id !== undefined) continue;
        for (const hop of graph[index]) {
          const total = min + hop.weight;
          if (total < dist[hop.index]) {dist[hop.index] = total; previous[hop.index] = index;}
        }
      }
      return previous;
    }
    const parents = new Map();
    return (source, target, paired) => {
      const from = centers.get(source), to = centers.get(target);
      if (from === undefined || to === undefined || source === target) return '';
      if (!parents.has(source)) parents.set(source,pathsFrom(source));
      const previous = parents.get(source), route = [points[to]];
      for (let i=previous[to]; i!==-1 && i!==from; i=previous[i]) route.push(points[i]);
      route.push(points[from]);
      return routePath(route.reverse(), points[from], points[to], paired);
    };
  }

  // Panning and hovering do not move the orbits. Reuse their visibility graph
  // until the layout or the zoom-dependent caption bounds actually change.
  let lastGeometry, planner;
  function chapterRoutes(edges, chapters) {
    const geometry = JSON.stringify([...chapters].map(([id,p]) =>
      [id,p.x,p.y,p.radius,p.labelWidth,p.labelTop,p.labelBottom]));
    if (lastGeometry !== geometry) {
      planner = routePlanner(chapters);
      lastGeometry = geometry;
    }
    const paths = new Map(), directed = new Set(edges.map(e => JSON.stringify([e.source,e.target])));
    for (const edge of edges) {
      const path = planner(edge.source, edge.target, directed.has(JSON.stringify([edge.target,edge.source])));
      if (path) paths.set(edge, path);
    }
    return paths;
  }

  function routes(data, zoom, edges = data.views.find(v => v.id === 'overview').edges) {
    const {title,subtitle} = textSizes(zoom);
    const chapters = new Map(overviewNodes(data).map(n => {
      const width = Math.min(columnWidth-28, Math.max(Array.from(n.label || '').length*title, Array.from(n.entry || '').length*subtitle));
      return [n.id, {...position(data,n.target), radius:orbitRadius+9, labelWidth:width,
        labelTop:83, labelBottom:83+title+(n.entry ? subtitle*1.4 : 0)}];
    }));
    return chapterRoutes(edges,chapters);
  }

  // Retain the per-link signature for older local pages while they are refreshed.
  function edge(data,sourceId,targetId,zoom=.4) {
    const overview=data.views.find(view=>view.id==='overview');
    const source=overview.nodes.find(node=>node.target===sourceId)?.id;
    const target=overview.nodes.find(node=>node.target===targetId)?.id;
    const link=overview.edges.find(item=>item.source===source&&item.target===target);
    return routes(data,zoom).get(link)||'';
  }

  function shorten(value, maxWidth) {
    const chars = Array.from(value || '');
    let width = 0;
    for (const [i, char] of chars.entries()) {
      width += char === ' ' ? .30 : /[\x21-\x7e·]/.test(char) ? .58 : 1;
      if (width > maxWidth) return chars.slice(0,Math.max(1,i-1)).join('')+'…';
    }
    return chars.join('');
  }

  function world(data,view,title,colour,zoom,selection,interactive) {
    const center = position(data,view.id);
    const metadata = overviewNodes(data).find(node=>node.target===view.id);
    const layers = bands(data), index = layers.findIndex(band=>band.level===metadata?.level);
    const water = palette(Math.max(index,0),layers.length);
    const group = svgNode('g',{class:'ocean-world','data-world':view.id,style:`--world:${colour};--ocean-ink:${water.ink};--ocean-note:${water.muted};--ocean-halo:${water.bottom}`});
    group.append(svgNode('circle',{cx:center.x,cy:center.y,r:orbitRadius,class:'world-ring'}));
    group.append(svgNode('circle',{cx:center.x,cy:center.y,r:orbitRadius,fill:'transparent','aria-hidden':'true',
      'data-ref':JSON.stringify({type:'world',world:view.id})}));
    const core = svgNode('g',{class:'world-core'});
    const countSize = Math.min(44,Math.max(24,10/zoom));
    core.append(svgNode('circle',{cx:center.x,cy:center.y,r:40}),svgNode('text',{x:center.x,y:center.y+countSize*.34,'text-anchor':'middle','font-size':countSize,class:'world-count'},String(view.nodes.length)));
    const {title:font, subtitle:subtitleFont} = textSizes(zoom);
    const labelY = center.y + 83 + font*.83;
    const entry = metadata?.entry || '';
    const label = svgNode('text',{x:center.x,y:labelY,'text-anchor':'middle','font-size':font,class:'world-label'},shorten(title,Math.max(2,(columnWidth-30)/font)));
    const captions = svgNode('g',{'aria-hidden':'true',class:'ocean-captions','data-ref':JSON.stringify({type:'world',world:view.id})});
    captions.append(label);
    if(entry) {
      const compactEntry = zoom < .30 ? entry.replace(/\s*·\s*/g,'·') : entry;
      captions.append(svgNode('text',{x:center.x,y:labelY+subtitleFont*1.40,'text-anchor':'middle','font-size':subtitleFont,class:'ocean-entry'},shorten(compactEntry,Math.max(2,(columnWidth-28)/subtitleFont))));
    }
    core.append(svgNode('title',{},[title,entry].filter(Boolean).join(' · ')));
    interactive(core,{type:'world',world:view.id},'展开板块 '+title);
    group.append(core,captions);
    view.nodes.forEach((node,i) => {
      const offset = satelliteOffset(i,view.nodes.length);
      const x=center.x+offset.x,y=center.y+offset.y;
      const selected = selection?.type==='node' && selection.world===view.id && selection.node===node.id;
      const small = svgNode('g',{class:'knowledge-node'+(selected?' selected':'')});
      small.append(svgNode('circle',{cx:x,cy:y,r:Math.min(11,orbitRadius*Math.sin(Math.PI/Math.max(2,view.nodes.length))*.92),class:'satellite'}));
      if(zoom>.65) small.append(svgNode('text',{x,y:y+4,'font-size':10,class:'node-number'},String(i+1)));
      small.append(svgNode('title',{},node.label));
      interactive(small,{type:'node',world:view.id,node:node.id},view.title+'：'+node.label);
      group.append(small);
    });
    return group;
  }

  return {bands,rowY,nearestRow,position,bounds,fit,opening,satellite,background,edge,routes,chapterRoutes,world};
})();
