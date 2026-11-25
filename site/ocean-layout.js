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

  function routeGeometry(data) {
    const overview = data.views.find(view => view.id === 'overview');
    const positions = new Map(overview.nodes.map(node => [node.id, position(data, node.target)]));
    const points = [...positions.values()];
    const left = Math.min(0,...points.map(point=>point.x));
    const right = Math.max(0,...points.map(point=>point.x));
    const middle = (left + right) / 2;
    const lanes = {left:[], right:[]};
    const links = overview.edges.map(edge => {
      const from = positions.get(edge.source), to = positions.get(edge.target);
      const link = {edge,from,to};
      if (from && to && Math.abs(to.y-from.y)>rowHeight*1.6) {
        const mean = (from.x+to.x)/2;
        link.side = (mean===middle ? from.x : mean) >= middle ? 1 : -1;
        lanes[link.side>0 ? 'right' : 'left'].push(link);
      }
      return link;
    }).filter(link=>link.from && link.to);
    for(const [side,group] of Object.entries(lanes)) {
      // Shorter jumps stay inside longer jumps, each on an independently clickable rail.
      group.sort((a,b)=>Math.abs(a.from.y-a.to.y)-Math.abs(b.from.y-b.to.y));
      group.forEach((link,index)=>{
        link.slot=index;
        link.rail=(side==='left' ? left : right)+link.side*(96+index*36);
      });
    }
    return {points,left,right,lanes,links};
  }

  function bounds(data) {
    const {points,left,right,lanes} = routeGeometry(data);
    const vertical = bands(data).map(band => rowY(data, band.level));
    const margin = laneCount=>Math.max(136,106+Math.max(0,laneCount-1)*36);
    const minX = left-margin(lanes.left.length), maxX = right+margin(lanes.right.length);
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

  // Standard routes leave below the captions and arrive above the receiving orbit.
  // Long routes run around the intervening layers so the lines do not cut through their circles.
  function textSizes(zoom) {
    return {
      title: Math.max(22,(zoom<.30?10.5:13.5)/zoom),
      subtitle: Math.max(16,(zoom<.30?8.8:10.7)/zoom),
    };
  }

  function routes(data, zoom) {
    const {links} = routeGeometry(data);
    const out = new Map(), incoming = new Map();
    for (const link of links) {
      if (!out.has(link.edge.source)) out.set(link.edge.source,[]);
      if (!incoming.has(link.edge.target)) incoming.set(link.edge.target,[]);
      out.get(link.edge.source).push(link);
      incoming.get(link.edge.target).push(link);
    }
    const compare = (a,b)=>a.x-b.x || a.y-b.y;
    for (const group of out.values()) group.sort((a,b)=>compare(a.to,b.to));
    for (const group of incoming.values()) group.sort((a,b)=>compare(a.from,b.from));
    function port(group,link) {
      return (group.indexOf(link)-(group.length-1)/2)*Math.min(20,100/Math.max(1,group.length-1));
    }
    const sizes = textSizes(zoom);
    const bottom = 90+sizes.title*.83+sizes.subtitle*1.6;
    const paths = new Map();
    for (const link of links) {
      const {edge,from:a,to:b}=link;
      const dx=b.x-a.x,dy=b.y-a.y,direction=Math.sign(dy);
      const startPort=port(out.get(edge.source),link), endPort=port(incoming.get(edge.target),link);
      let path;
      if (Math.abs(dy)<155) {
        const side=dx>=0?1:-1, start=a.x+75*side, end=b.x-75*side;
        path=`M ${start} ${a.y-22} C ${start+60*side} ${a.y-96}, ${end-60*side} ${b.y-96}, ${end} ${b.y-22}`;
      } else if (link.side) {
        const sx=a.x+startPort, ex=b.x+endPort;
        const sy=a.y+(dy>0?bottom:-84), ey=b.y+(dy>0?-Math.sqrt(84**2-endPort**2):bottom);
        const departure=sy+direction*(22+link.slot*14), approach=ey-direction*(26+link.slot*14);
        const {rail}=link;
        const bend=Math.min(Math.abs(approach-departure)*.36,94);
        path=`M ${sx} ${sy} C ${sx} ${departure+direction*bend*.48}, ${rail} ${departure-direction*bend*.15}, ${rail} ${departure+direction*bend} L ${rail} ${approach-direction*bend} C ${rail} ${approach+direction*bend*.15}, ${ex} ${approach-direction*bend*.48}, ${ex} ${ey}`;
      } else {
        // Separate arrivals around the top arc. Diagonal routes leave on the side
        // facing their destination, which keeps the whole inter-layer space usable.
        const side=Math.sign(dx);
        const diagonal=Math.abs(dx)>140 && Math.abs(dx)<columnWidth*.85;
        const sx=a.x+(diagonal ? side*76 : startPort);
        const sy=a.y+(diagonal ? direction*(20+startPort*.42) : (dy>0?bottom:-84));
        const ex=b.x+endPort, ey=b.y+(dy>0 ? -Math.sqrt(84**2-endPort**2) : bottom);
        const rise=ey-sy;
        const controlX=sx+(ex-sx)*.58;
        const swing=Math.max(.18,Math.min(.57,.35+(startPort-endPort)/170));
        path=`M ${sx} ${sy} C ${controlX} ${sy+rise*swing}, ${ex} ${sy+rise*.60}, ${ex} ${ey}`;
      }
      paths.set(edge,path);
    }
    return paths;
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
    const group = svgNode('g',{class:'ocean-world',style:`--world:${colour};--ocean-ink:${water.ink};--ocean-note:${water.muted};--ocean-halo:${water.bottom}`});
    group.append(svgNode('circle',{cx:center.x,cy:center.y,r:orbitRadius,class:'world-ring'}));
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

  return {bands,rowY,nearestRow,position,bounds,fit,opening,satellite,background,edge,routes,world};
})();
