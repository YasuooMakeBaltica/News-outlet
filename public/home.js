// Front page: the lead story, then the rest in newspaper columns. Sections and search via the URL.
(() => {
  const { $, el, fill, api, fmtDate } = window.News;
  const PAGE = 13; // one lead story + twelve more
  const params = new URLSearchParams(location.search);
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  let page = Math.max(parseInt(params.get('page'), 10) || 1, 1);

  $('#search').elements.q.value = q;
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    const value = e.target.elements.q.value.trim();
    if (value) next.set('q', value);
    if (category) next.set('category', category);
    location.search = next.toString();
  });

  if (category || q) {
    $('#sectionTitle').hidden = false;
    $('#sectionTitle').textContent = q ? `Search: “${q}”${category ? ` in ${category}` : ''}` : category;
    document.title = q ? `Search: ${q}` : category;
  }

  const link = (a) => `/article.html?slug=${encodeURIComponent(a.slug)}`;
  const byline = (a) => [a.authorName && `By ${a.authorName}`, fmtDate(a.publishedAt), `${a.readingMinutes} min read`,
    a.commentCount ? `${a.commentCount} comment${a.commentCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');

  function story(a, lead) {
    return el('article', { className: lead ? 'story lead' : 'story' },
      lead && a.image ? el('a', { href: link(a), className: 'story-image' }, el('img', { src: a.image, alt: a.imageCaption || '', loading: 'lazy', referrerPolicy: 'no-referrer' })) : null,
      el('p', { className: 'kicker' },
        el('a', { href: `/?category=${encodeURIComponent(a.category)}`, textContent: a.category })),
      el(lead ? 'h2' : 'h3', {}, el('a', { href: link(a), textContent: a.title })),
      a.summary ? el('p', { className: 'standfirst', textContent: a.summary }) : null,
      el('p', { className: 'byline', textContent: byline(a) }));
  }

  function pager(total) {
    const pages = Math.ceil(total / PAGE);
    const nav = $('#pager');
    nav.hidden = pages <= 1;
    if (nav.hidden) return;
    const go = (n) => () => { page = n; load(); window.scrollTo({ top: 0 }); };
    nav.replaceChildren(
      el('button', { type: 'button', className: 'page-btn', textContent: '‹ Newer', disabled: page <= 1, onclick: go(page - 1) }),
      el('span', { className: 'page-info', textContent: `Page ${page} of ${pages}` }),
      el('button', { type: 'button', className: 'page-btn', textContent: 'Older ›', disabled: page >= pages, onclick: go(page + 1) }));
  }

  async function load() {
    const box = $('#stories');
    const query = new URLSearchParams({ limit: PAGE, offset: (page - 1) * PAGE });
    if (category) query.set('category', category);
    if (q) query.set('q', q);
    try {
      const { data, res } = await api(`/api/articles?${query}`);
      const total = parseInt(res.headers.get('X-Total-Count'), 10) || data.length;
      if (!data.length) {
        box.replaceChildren(el('p', { className: 'empty', textContent: q ? 'No articles match your search.' : category ? 'No articles in this section yet.' : 'No articles published yet. Check back soon.' }));
      } else {
        const [first, ...rest] = data;
        const showLead = page === 1 && !q;
        fill(box,
          showLead ? story(first, true) : null,
          el('div', { className: 'columns' }, ...(showLead ? rest : data).map((a) => story(a, false))));
      }
      pager(total);
    } catch (err) {
      box.replaceChildren(el('p', { className: 'empty', textContent: `Could not load the news: ${err.message}` }));
    }
  }

  load();
})();
