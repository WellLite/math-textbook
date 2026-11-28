// Review builds mark the passages that can receive public, page-scoped feedback.
(() => {
  const article = document.querySelector('article[data-note-page]');
  if (!article) return;
  const page = article.dataset.notePage;
  const sharedLocalReview = ['http://127.0.0.1:8770', 'http://localhost:8770'].includes(location.origin);
  const api = new URL('/api/annotations', sharedLocalReview ? 'https://math-textbook-review.pages.dev' : location.origin);
  const threads = new Map();
  const notes = new Map();
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  let loadState = 'loading';
  let loading = null;
  let revision = 0;
  let unmatched = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(className, text) {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  }

  function compact(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function excerpt(text, limit) {
    return Array.from(text).slice(0, limit).join('');
  }

  function passageText(host) {
    if (host.dataset.noteQuote) return compact(host.dataset.noteQuote);
    const copy = (host.querySelector('figcaption') || host).cloneNode(true);
    copy.querySelectorAll('.math-demo, .review-notes, .note-trigger, [aria-hidden="true"], script').forEach(e => e.remove());
    for (const math of copy.querySelectorAll('math')) {
      const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      math.querySelectorAll('annotation, annotation-xml').forEach(e => e.remove());
      math.replaceWith(' ' + (tex || math.textContent) + ' ');
    }
    for (const image of copy.querySelectorAll('img')) image.replaceWith(image.alt);
    return compact(copy.textContent);
  }

  function readDraft(thread) {
    try { return JSON.parse(localStorage.getItem(thread.key)); } catch { return null; }
  }

  function saveDraft(thread) {
    try {
      if (thread.draft.body) localStorage.setItem(thread.key, JSON.stringify(thread.draft));
      else localStorage.removeItem(thread.key);
    } catch { /* The open form remains usable when browser storage is unavailable. */ }
  }

  function newRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function validNote(note) {
    return note && typeof note.id === 'string' && typeof note.anchor === 'string' && typeof note.body === 'string';
  }

  async function request(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, {...options, signal: controller.signal, cache: 'no-store'});
      if (!response.ok) {
        const error = new Error('Annotation request failed');
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function renderNote(note, withQuote) {
    const row = element('div', 'note-entry');
    row.setAttribute('role', 'listitem');
    if (withQuote && note.quote) row.append(element('blockquote', 'note-quote', note.quote));
    row.append(element('p', 'note-body', note.body));
    const date = new Date(note.createdAt);
    if (Number.isFinite(date.getTime())) {
      const time = element('time', 'note-date', dateFormat.format(date));
      time.dateTime = date.toISOString();
      row.append(time);
    }
    return row;
  }

  function matchThread(note) {
    if (threads.has(note.anchor)) return threads.get(note.anchor);
    const quote = typeof note.quote === 'string' ? compact(note.quote) : '';
    if (!quote) return null;
    // A former anchor may have disappeared after a small edit. Never guess between repeated passages.
    const matches = [...threads.values()].filter(t => t.text === quote || (quote.length >= 8 && t.text.startsWith(quote)));
    return matches.length === 1 ? matches[0] : null;
  }

  function labelTrigger(thread) {
    const count = thread.items.length;
    const hasDraft = Boolean(thread.draft.body);
    thread.badge.textContent = count ? String(count) : '';
    thread.trigger.classList.toggle('has-notes', count > 0);
    thread.trigger.classList.toggle('has-draft', hasDraft);
    const action = hasDraft ? '继续写未发布的草稿' : '写批注';
    const label = (count ? '查看 ' + count + ' 条批注或' : '') + action + '，' + thread.label;
    thread.trigger.setAttribute('aria-label', label);
    thread.trigger.title = label;
  }

  function renderThread(thread) {
    labelTrigger(thread);
    const count = thread.items.length;
    if (!thread.ui || thread.panel.hidden) return;
    const {list, heading, fetchStatus, retry} = thread.ui;
    heading.textContent = count ? '本处批注 · ' + count : '本处批注';
    list.replaceChildren(...thread.items.map(note => renderNote(note, false)));
    list.hidden = count === 0;
    fetchStatus.textContent = loadState === 'error' ? '共享批注暂时未能读取。' :
      loadState === 'loading' && !count ? '正在读取共享批注…' :
      loadState === 'ready' && !count ? '这里还没有公开批注。' : '';
    retry.hidden = loadState !== 'error';
  }

  function renderPage() {
    for (const thread of threads.values()) thread.items = [];
    const former = [];
    const ordered = [...notes.values()].sort((a, b) =>
      String(a.note.createdAt).localeCompare(String(b.note.createdAt)) || a.note.id.localeCompare(b.note.id));
    for (const {note} of ordered) {
      const thread = matchThread(note);
      if (thread) thread.items.push(note);
      else former.push(note);
    }
    for (const thread of threads.values()) renderThread(thread);
    if (former.length) {
      if (!unmatched) {
        unmatched = element('details', 'review-notes note-former');
        const list = element('div', 'note-list');
        list.setAttribute('role', 'list');
        unmatched.append(element('summary'), list);
        article.append(unmatched);
      }
      unmatched.firstElementChild.textContent = '原段落已调整的批注 · ' + former.length;
      unmatched.lastElementChild.replaceChildren(...former.map(note => renderNote(note, true)));
    } else if (unmatched) {
      unmatched.remove();
      unmatched = null;
    }
  }

  function refresh() {
    if (loading) return loading;
    const started = revision;
    const url = new URL(api);
    url.searchParams.set('page', page);
    loadState = 'loading';
    renderPage();
    loading = (async () => {
      try {
        const received = [];
        const cursors = new Set();
        while (true) {
          const data = await request(url);
          if (!Array.isArray(data.annotations) || !data.annotations.every(validNote)) throw new Error('Invalid annotation list');
          received.push(...data.annotations);
          if (data.nextCursor == null) break;
          if (typeof data.nextCursor !== 'string' || !data.nextCursor || cursors.has(data.nextCursor)) throw new Error('Invalid annotation cursor');
          cursors.add(data.nextCursor);
          url.searchParams.set('cursor', data.nextCursor);
        }
        // Preserve submissions that succeeded while this earlier snapshot was being read.
        for (const [id, item] of notes) if (item.revision <= started) notes.delete(id);
        for (const note of received) if (!notes.has(note.id)) notes.set(note.id, {note, revision: started});
        loadState = 'ready';
      } catch {
        loadState = 'error';
      } finally {
        loading = null;
        renderPage();
      }
    })();
    return loading;
  }

  async function submit(thread) {
    const {field, publish, feedback} = thread.ui;
    if (publish.disabled) return;
    const body = field.value.trim();
    if (!body || Array.from(body).length > 2000) {
      field.setAttribute('aria-invalid', 'true');
      feedback.textContent = body ? '批注最多可写 2000 字。' : '请先写下批注。';
      field.focus();
      return;
    }
    // Save the identity before sending. Even an interrupted or timed-out POST can be safely retried.
    if (thread.draft.sentBody !== body || !thread.draft.requestId) {
      thread.draft.requestId = newRequestId();
      thread.draft.sentBody = body;
    }
    const requestId = thread.draft.requestId;
    thread.draft.body = field.value;
    saveDraft(thread);
    field.readOnly = true;
    publish.disabled = true;
    feedback.textContent = '正在发布…';
    try {
      const data = await request(api, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({page, anchor: thread.anchor, quote: excerpt(thread.text, 240), body, requestId})
      });
      const note = data.annotation;
      if (!validNote(note) || note.anchor !== thread.anchor) throw new Error('Invalid annotation');
      notes.set(note.id, {note, revision: ++revision});
      // A draft edited in another tab after this request started belongs to that tab.
      const stored = readDraft(thread);
      if (stored?.requestId === requestId && stored.body === field.value) {
        try { localStorage.removeItem(thread.key); } catch { /* No persistent storage. */ }
      }
      thread.draft = {body: ''};
      field.value = '';
      feedback.textContent = '批注已公开。';
      renderPage();
    } catch (error) {
      feedback.textContent = error.status === 429 ? '发布较频繁，请稍后重试。草稿仍在这里。' :
        error.status === 413 ? '批注过长，请缩短后再发布。草稿仍在这里。' :
        '未能确认发布结果。草稿仍在这里，可以重试。';
    } finally {
      field.readOnly = false;
      publish.disabled = false;
    }
  }

  function openEditor(thread) {
    const {panel, trigger, index} = thread;
    if (!thread.ui) {
      const heading = element('h3', 'note-heading', '本处批注');
      heading.id = 'review-note-heading-' + index;
      heading.tabIndex = -1;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-labelledby', heading.id);
      const close = button('note-close', '收起');
      close.addEventListener('click', () => {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      });
      const head = element('div', 'note-head');
      head.append(heading, close);
      const list = element('div', 'note-list');
      list.setAttribute('role', 'list');
      const fetchStatus = element('span');
      fetchStatus.setAttribute('role', 'status');
      const retry = button('note-retry', '重新读取');
      retry.addEventListener('click', refresh);
      const info = element('div', 'note-fetch');
      info.append(fetchStatus, retry);
      const form = element('form', 'note-form');
      const label = element('label', '', '写一条公开批注');
      const field = element('textarea');
      field.rows = 3;
      field.id = 'review-note-text-' + index;
      label.htmlFor = field.id;
      field.value = thread.draft.body;
      const feedback = element('span', 'note-feedback');
      feedback.setAttribute('role', 'status');
      feedback.id = 'review-note-feedback-' + index;
      field.setAttribute('aria-describedby', feedback.id);
      field.addEventListener('input', () => {
        thread.draft.body = field.value;
        labelTrigger(thread);
        field.removeAttribute('aria-invalid');
        feedback.textContent = '';
        saveDraft(thread);
      });
      const publish = button('note-publish', '发布批注');
      publish.type = 'submit';
      const actions = element('div', 'note-actions');
      actions.append(publish, feedback);
      form.append(label, field, actions);
      form.addEventListener('submit', event => { event.preventDefault(); submit(thread); });
      panel.append(head, list, info, form);
      thread.ui = {heading, list, fetchStatus, retry, field, publish, feedback};
    }
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderThread(thread);
    const headingBox = thread.ui.heading.getBoundingClientRect();
    const headerBottom = document.querySelector('.chapter-header')?.getBoundingClientRect().bottom || 0;
    if (headingBox.top < headerBottom || headingBox.bottom > innerHeight) panel.scrollIntoView({block: 'start'});
    if (thread.items.length || loadState !== 'ready') thread.ui.heading.focus({preventScroll: true});
    else thread.ui.field.focus({preventScroll: true});
    refresh();
  }

  // Capture the source text before installing controls (including in nested lists).
  const passages = [...article.querySelectorAll('[data-note-anchor]')].map(host => ({host, text: passageText(host)}));
  passages.forEach(({host, text}, index) => {
    const anchor = host.dataset.noteAnchor;
    if (!anchor || threads.has(anchor)) return;
    const trigger = button('note-trigger', '批注');
    const badge = element('span', 'note-count');
    trigger.append(badge);
    const panel = element('div', 'review-notes note-panel');
    panel.hidden = true;
    panel.id = 'review-note-panel-' + index;
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    const label = text ? excerpt(text, 32) : '第 ' + (index + 1) + ' 处';
    const thread = {anchor, label, text, index, trigger, badge, panel, items: [], key: 'math-textbook:note-draft:' + page + ':' + anchor};
    const draft = readDraft(thread);
    thread.draft = draft && typeof draft.body === 'string' ? draft : {body: ''};
    threads.set(anchor, thread);
    if (host.matches('li')) {
      host.classList.add('note-host');
      host.append(trigger, panel);
    } else if (host.matches('p') && !host.querySelector('math[display="block"], img')) {
      host.classList.add('note-host');
      host.append(trigger);
      host.after(panel);
    } else {
      const tools = element('div', 'review-notes note-media-tools');
      tools.append(trigger, panel);
      host.after(tools);
    }
    trigger.addEventListener('click', () => {
      if (panel.hidden) openEditor(thread);
      else {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  });
  refresh();
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
