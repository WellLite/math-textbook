// Keep a place in this edition of the book, including when served under a Pages project path.
(() => {
  const book = new URL('.', document.currentScript.src);
  const bookmarkKey = 'math-textbook:bookmark:' + book.pathname;
  const typeKey = 'math-textbook:large-type:' + book.pathname;
  const topic = document.querySelector('[data-reading-topic]');
  const resumeLinks = document.querySelectorAll('[data-resume-reading]');

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
  }
  function refreshResume() {
    const mark = read(bookmarkKey);
    const url = typeof mark?.path === 'string' && mark.path.startsWith('chapters/') ? new URL(mark.path, book) : null;
    const valid = url && url.origin === book.origin && url.pathname.startsWith(book.pathname + 'chapters/')
      && url.pathname.endsWith('.html') && !url.search && !url.hash && typeof mark.topic === 'string';
    resumeLinks.forEach(link => {
      link.hidden = !valid;
      if (valid) {
        url.hash = 'resume';
        link.href = url.href;
        link.textContent = '继续读 · ' + mark.topic;
      }
    });
  }
  if (resumeLinks.length) {
    refreshResume();
    window.addEventListener('pageshow', refreshResume);
    window.addEventListener('storage', refreshResume);
  }

  const find = document.getElementById('find-lesson');
  if (find) {
    const sections = document.querySelectorAll('.directory-section');
    const status = document.getElementById('found-lessons');
    function matchLessons() {
      const words = find.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      let matches = 0;
      for (const section of sections) {
        const heading = section.querySelector('h2');
        let visible = 0;
        for (const row of section.querySelectorAll('li')) {
          const text = (heading.textContent + row.textContent).toLocaleLowerCase();
          row.hidden = !words.every(word => text.includes(word));
          if (!row.hidden) visible++;
        }
        section.hidden = visible === 0;
        matches += visible;
      }
      document.querySelector('.directory-layout nav').hidden = words.length > 0;
      status.textContent = !words.length ? '' : matches ? '找到 ' + matches + ' 篇' : '没有找到。可以换一个词。';
    }
    find.parentElement.hidden = false;
    find.addEventListener('input', matchLessons);
    window.addEventListener('pageshow', matchLessons);
  }

  if (!topic) return;
  const largeType = document.getElementById('large-type');
  function setType(large) {
    document.documentElement.classList.toggle('large-type', large);
    largeType.setAttribute('aria-pressed', String(large));
  }
  setType(read(typeKey) === true);
  largeType.hidden = false;
  largeType.addEventListener('click', () => {
    const large = largeType.getAttribute('aria-pressed') !== 'true';
    setType(large);
    save(typeKey, large);
  });

  const path = location.pathname.slice(book.pathname.length);
  const header = document.querySelector('.chapter-header');
  const blocks = [...document.querySelectorAll('.chapter article > *, .reading-end')];
  const last = read(bookmarkKey);
  let restoring = location.hash === '#resume' && last?.path === path;
  let visible = !document.hidden;
  let timer;
  function keepPlace() {
    if (restoring || !visible) return;
    // Record the first visible block and the fraction already read within it.
    // The same paragraph can then be located after wrapping at a different width.
    const edge = header.getBoundingClientRect().bottom;
    const block = window.scrollY > 0 ? blocks.findIndex(b => b.getBoundingClientRect().bottom > edge) : -1;
    const bounds = blocks[block]?.getBoundingClientRect();
    const fraction = bounds?.height ? (edge - bounds.top) / bounds.height : 0;
    save(bookmarkKey, { path, topic: topic.textContent, block, fraction });
  }
  if (restoring) {
    function restorePlace() {
      const block = blocks[last.block];
      if (block && Number.isFinite(last.fraction)) {
        const bounds = block.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + bounds.top - header.getBoundingClientRect().bottom + bounds.height * last.fraction);
      }
      history.replaceState(history.state, '', location.pathname + location.search);
      restoring = false;
      keepPlace();
    }
    if (document.readyState === 'complete') restorePlace();
    else window.addEventListener('load', restorePlace, { once: true });
  } else {
    keepPlace();
  }
  window.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(keepPlace, 180);
  }, { passive: true });
  window.addEventListener('pagehide', () => { clearTimeout(timer); keepPlace(); });
  window.addEventListener('pageshow', event => {
    visible = !document.hidden;
    if (event.persisted) keepPlace();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      keepPlace();
      visible = false;
    } else {
      visible = true;
      keepPlace();
    }
  });
})();
