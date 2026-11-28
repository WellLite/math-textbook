// The same geometry supplies the printed illustration and the reader's movable frame.
(() => {
  const ink = '#203e43', teal = '#08746e', red = '#9a482f', pale = '#afc5be';
  const number = n => Number(n.toFixed(2));
  const move = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  function line(a, b, color = pale, width = 1.5, dashed = false) {
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="5 5"' : ''}/>`;
  }
  function dot(p, color, r = 4) {
    return `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${color}"/>`;
  }
  function label(p, value, color = ink) {
    return `<text x="${p[0]}" y="${p[1]}" fill="${color}" text-anchor="middle" font-size="16" font-family="system-ui,sans-serif" stroke="#f8faf7" stroke-width="3" paint-order="stroke">${value}</text>`;
  }
  function arrow(a, b, color) {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const size = Math.min(10, Math.hypot(b[1] - a[1], b[0] - a[0]) * .45);
    const wing = sign => [b[0] - size * Math.cos(angle + sign * .45), b[1] - size * Math.sin(angle + sign * .45)];
    return line(a, b, color, 3) + line(wing(1), b, color, 3) + line(wing(-1), b, color, 3);
  }
  function picture(height, marks) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 ${height}" aria-hidden="true"><rect width="400" height="${height}" fill="#f8faf7"/>${marks}</svg>`;
  }
  function quantifierCheck(title, entries, isBall) {
    const some = isBall ? '至少一颗是红球' : '至少一个数是解';
    const every = isBall ? '每一颗都是红球' : '每一个数都是解';
    return {
      title, control: isBall ? '已经查看的球数' : '已经代入的数目',
      max: 3, step: 1, base: 3, ticks: ['0', '1', '2', '3'],
      frame(count) {
        const seen = entries.slice(0, count);
        const witness = seen.find(entry => entry.matches);
        const counterexample = seen.find(entry => !entry.matches);
        const complete = count === entries.length;
        const someState = witness ? '成立' : complete ? '不成立' : '待检查';
        const everyState = counterexample ? '不成立' : complete ? '成立' : '待检查';
        let marks = '';
        entries.forEach((entry, i) => {
          const x = 75 + 125 * i;
          const revealed = i < count;
          const caption = revealed ? entry.result : '待检查';
          const color = !revealed ? '#5b6863' : entry.matches ? teal : red;
          if (isBall) {
            const fill = !revealed ? '#e5ebe6' : entry.matches ? '#ad4d40' : '#356f9a';
            marks += dot([x, 42], fill, 19) + label([x, 84], entry.name + ' · ' + caption, color);
          } else {
            marks += label([x, 42], 'x = ' + entry.name) + label([x, 77], caption, color);
          }
        });
        marks += line([26, 99], [374, 99], pale, 1);
        marks += label([200, 127], some + '　' + someState);
        marks += label([200, 157], every + '　' + everyState);
        const evidence = count === 0
          ? (isBall ? '袋中有三颗球，还没看过任何一颗。' : '集合中有三个数，尚未逐项代入。')
          : (isBall ? entries[count - 1].name + '是' + entries[count - 1].result + '。'
                    : '代入 ' + entries[count - 1].name + ' 得 ' + entries[count - 1].result + '。');
        const whySome = witness ? '已有' + (isBall ? witness.name + '这颗红球' : '见证 ' + witness.name) : '';
        const whyEvery = counterexample ? '已有反例' + (isBall ? '，' + counterexample.name + '不是红球' : ' ' + counterexample.name) : '';
        const verdict = (name, state, reason) => name + '：' + state + (reason ? '（' + reason + '）' : '') + '。';
        return {svg: picture(175, marks), status: evidence + verdict(some, someState, whySome) + verdict(every, everyState, whyEvery)};
      }
    };
  }
  const demos = {
    'quantifier-balls': quantifierCheck('看过几颗球，就能回答两个问题？', [
      {name: '甲', result: '红球', matches: true},
      {name: '乙', result: '蓝球', matches: false},
      {name: '丙', result: '红球', matches: true}
    ], true),
    'quantifier-roots': quantifierCheck('逐项检验 x² = x 的候选解', [
      {name: '0', result: '0² = 0', matches: true},
      {name: '1', result: '1² = 1', matches: true},
      {name: '2', result: '2² ≠ 2', matches: false}
    ], false),
    'successor-walk': {
      title: '同一个后继操作，重复多少次？', control: '后继次数', max: 4, step: 1,
      ticks: ['0 次', '2 次', '4 次'], base: 2,
      frame(value) {
        const x = k => 33 + k * 47;
        let marks = line([25, 84], [379, 84], ink, 2);
        for (let k = 0; k <= 7; k++) {
          marks += line([x(k), 80], [x(k), 90], ink) + label([x(k), 111], k);
        }
        for (let k = 3; k < 3 + value; k++) {
          marks += `<path d="M${x(k)} 79 q23.5 -45 47 0 l-9 -6 m9 6 l1 -10" fill="none" stroke="${teal}" stroke-width="2.8"/>`;
        }
        marks += dot([x(3), 84], ink) + dot([x(3 + value), 84], red, 5);
        return {svg: picture(132, marks), status: `从 3 出发，取 ${value} 次后继：3 + ${value} = ${3 + value}。`};
      }
    },
    'vector-addition': {
      title: '两种次序会到达哪里？', control: '移动进度', max: 100, step: 1, base: 100,
      ticks: ['起点 O', '第一步走完', '终点 C'], orders: ['先 u 后 v', '先 v 后 u'],
      frame(value, reverse) {
        const o = [65, 165], a = [231, 165], b = [132, 57], c = [298, 57];
        const mid = reverse ? b : a, first = reverse ? red : teal, second = reverse ? teal : red;
        const t = value / 50;
        let marks = line(o, a, pale, 2, true) + line(o, b, pale, 2, true) + line(b, c, pale, 2, true) + line(a, c, pale, 2, true) + line(o, c, ink, 1.6, true);
        const pos = t <= 1 ? move(o, mid, t) : move(mid, c, t - 1);
        marks += arrow(o, t < 1 ? pos : mid, first);
        if (t > 1) marks += arrow(mid, pos, second);
        marks += dot(pos, ink, 5) + label([53,185],'O') + label([240,185],'A') + label([124,48],'B') + label([309,49],'C');
        return {svg: picture(208, marks), status: value === 100 ? '两条路线的终点都是 C，合位移都是从 O 指向 C 的向量。' : value === 0 ? '从 O 出发。虚线标出两条路线和它们共用的对角线。' : t === 1 ? `第一步到达 ${reverse ? 'B' : 'A'}，下一支箭头从这里出发。` : `正在走第${t < 1 ? '一' : '二'}步，沿向量 ${(t < 1) !== reverse ? 'u' : 'v'} 前进。`};
      }
    },
    'matrix-composition': {
      title: '同一个单位向量，两种变换次序', control: '变换进度', max: 100, step: 1, base: 100,
      ticks: ['原图', '完成第一步', '完成第二步'], orders: ['先拉伸后错切', '先错切后拉伸'],
      frame(value, reverse) {
        const t = value / 50;
        const stretch = 1 + (reverse ? Math.max(0, t - 1) : Math.min(1, t));
        const shear = reverse ? Math.min(1, t) : Math.max(0, t - 1);
        const dx = shear * (reverse ? 1 : stretch);
        const at = (x, y) => [100 + 59 * (x + dx * y), 180 - 59 * stretch * y];
        const o = at(0,0), a = at(1,0), b = at(0,1), c = at(1,1);
        let marks = '';
        for (let k = -1; k <= 4; k++) marks += line([100 + k*59,31],[100 + k*59,191],pale,1);
        for (let k = 0; k <= 2; k++) marks += line([35,180-k*59],[350,180-k*59],pale,1);
        marks += `<polygon points="${[o,a,c,b].map(p=>p.join(',')).join(' ')}" fill="#c4e5db" stroke="${teal}" stroke-width="2"/>`;
        marks += arrow(o,a,teal) + arrow(o,b,red) + dot(b,red) + label([83,198],'O') + label([162,201],'e₁') + label([b[0]+8,b[1]-11],`(${number(dx)}, ${number(stretch)})`,red);
        const stage = t === 0 ? '初始位置' : t === 1 ? '第一步结束' : t === 2 ? '复合完成' : (t < 1) === reverse ? '水平错切中' : '竖向拉伸中';
        return {svg: picture(218, marks), status: `${stage}。e₁ 位于 (1, 0)，e₂ 的像位于 (${number(dx)}, ${number(stretch)})。`};
      }
    },
    'cyclic-angles': {
      title: '第四个点移动时，对角和怎么变？', control: '点 D 的位置', max: 100, step: 1, base: 50,
      ticks: ['圆内', '圆上', '圆外'],
      valueAtPoint(y) { return Math.max(0, Math.min(100, Math.round((y - 136) / 1.08))); },
      frame(value) {
        const a = [128,82], b = [200,34], c = [272,82];
        const h = 54 + 1.08 * value, d = [200, 82 + h];
        const beta = 2 * Math.atan2(72,48) * 180 / Math.PI;
        const delta = 2 * Math.atan2(72,h) * 180 / Math.PI;
        let marks = '<circle cx="200" cy="112" r="78" fill="none" stroke="#91ada3" stroke-width="2"/>' + line(a,c,pale,1.7,true);
        for (const [p,q] of [[a,b],[b,c],[c,d],[d,a]]) marks += line(p,q,ink,2);
        for (const [v,color] of [[b,teal],[d,red]]) {
          const side = 18 / Math.hypot(a[0]-v[0],a[1]-v[1]);
          const s = move(v,a,side), e = move(v,c,side);
          marks += `<path d="M${s} A18 18 0 0 ${v===d ? 1 : 0} ${e}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
        }
        marks += dot(a,ink) + dot(b,teal) + dot(c,ink) + dot(d,red,5);
        marks += `<circle data-drag-point="" cx="${d[0]}" cy="${d[1]}" r="15" fill="transparent"/>`;
        marks += label([114,84],'A') + label([200,25],'B',teal) + label([286,84],'C') + label([218,d[1]+8],'D',red);
        const where = value === 50 ? '圆上' : value < 50 ? '圆内' : '圆外';
        return {svg: picture(265, marks), status: `D 在${where}。∠B ≈ ${beta.toFixed(1)}°，∠D ≈ ${delta.toFixed(1)}°。对角和${value === 50 ? '恰为 180' : '约为 ' + (beta+delta).toFixed(1)}°。`};
      }
    }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = demos;
    return;
  }
  for (const [name, demo] of Object.entries(demos)) {
    const image = document.querySelector(`article figure img[src$="/${name}.svg"]`);
    if (!image) continue;
    const figure = image.closest('figure');
    const panel = document.createElement('div');
    panel.className = 'math-demo';
    const id = 'range-' + name;
    panel.innerHTML = `<h3>${demo.title}</h3><div class="demo-picture"></div>
      <div class="demo-settings"></div>
      <label for="${id}">${demo.control}</label><div class="demo-seek"><input id="${id}" type="range" min="0" max="${demo.max}" step="${demo.step}" value="0"><button type="button" class="demo-play">播放</button></div>
      <div class="demo-ticks" aria-hidden="true">${demo.ticks.map(t=>`<span>${t}</span>`).join('')}</div><p class="demo-status"></p>`;
    const input = panel.querySelector('input'), play = panel.querySelector('.demo-play');
    const stage = panel.querySelector('.demo-picture'), status = panel.querySelector('.demo-status');
    let order, raf = 0;
    function render() {
      const frame = demo.frame(Number(input.value), Boolean(order && order.selectedIndex));
      stage.innerHTML = frame.svg;
      status.textContent = frame.status;
      input.setAttribute('aria-valuetext', frame.status);
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      play.textContent = Number(input.value) === demo.max ? '重播' : '播放';
    }
    if (demo.orders) {
      order = document.createElement('select');
      order.setAttribute('aria-label','操作次序');
      for (const option of demo.orders) order.add(new Option(option));
      order.addEventListener('change', () => { stop(); render(); });
      panel.querySelector('.demo-settings').append(order);
    }
    if (demo.valueAtPoint) {
      stage.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.target.closest('[data-drag-point]')) return;
        stop();
        stage.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      stage.addEventListener('pointermove', event => {
        if (!stage.hasPointerCapture(event.pointerId)) return;
        const transform = stage.querySelector('svg').getScreenCTM();
        if (!transform) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
        input.value = demo.valueAtPoint(point.y);
        render();
      });
      stage.addEventListener('pointerup', event => {
        if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
        stop();
      });
    }
    input.addEventListener('input', () => { stop(); render(); });
    play.addEventListener('click', () => {
      if (raf) { stop(); return; }
      if (Number(input.value) >= demo.max) {
        input.value = 0;
        render();
      }
      const origin = performance.now() - Number(input.value) / demo.max * 4800;
      play.textContent = '暂停';
      function tick(now) {
        const next = Math.min(demo.max, Math.floor((now-origin)/4800*demo.max));
        if (Number(input.value) !== next) {
          input.value = next;
          render();
        }
        if (next === demo.max) stop();
        else raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
    });
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    render();
    figure.classList.add('has-math-demo');
    figure.insertBefore(panel, figure.firstChild);
  }
})();
