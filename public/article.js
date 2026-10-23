// A single article: the story, reactions and comments.
(() => {
  const { $, el, fill, api, fmtDate, renderBody, me, loginHref } = window.News;
  const slug = new URLSearchParams(location.search).get('slug') || '';
  let article = null;
  let viewer = { loggedIn: false };

  const STATUS = { draft: 'Draft — not published', submitted: 'Waiting for editor review', rejected: 'Sent back by an editor', published: '' };

  function renderArticle(a) {
    document.title = a.title;
    const box = $('#article');
    box.className = 'article';
    fill(box,
      a.status !== 'published' ? el('p', { className: 'notice', textContent: STATUS[a.status] || a.status }) : null,
      a.example ? el('p', { className: 'notice', textContent: 'Sample article: an example of what a story looks like on the site.' }) : null,
      el('p', { className: 'kicker' }, el('a', { href: `/?category=${encodeURIComponent(a.category)}`, textContent: a.category })),
      el('h1', { textContent: a.title }),
      a.summary ? el('p', { className: 'standfirst', textContent: a.summary }) : null,
      el('p', { className: 'byline' },
        `By ${a.authorName} · ${a.publishedAt ? fmtDate(a.publishedAt, true) : 'Unpublished'} · ${a.readingMinutes} min read`,
        a.canEdit ? el('a', { className: 'edit-link', href: `/newsroom.html?edit=${encodeURIComponent(a.id)}`, textContent: 'Edit' }) : null),
      a.image ? el('figure', {},
        el('img', { src: a.image, alt: a.imageCaption || '', referrerPolicy: 'no-referrer' }),
        a.imageCaption ? el('figcaption', { textContent: a.imageCaption }) : null) : null,
      el('div', { className: 'article-body' }, renderBody(a.body)));
  }

  // --- reactions ---------------------------------------------------------------------
  async function renderReactions() {
    const box = $('#reactions');
    box.hidden = article.status !== 'published';
    if (box.hidden) return;
    const { reactions } = await window.News.site;
    box.replaceChildren(el('span', { className: 'reactions-label', textContent: 'React:' }), ...reactions.map((emoji) => {
      const mine = article.myReactions.includes(emoji);
      const btn = el('button', {
        type: 'button', className: `reaction${mine ? ' mine' : ''}`,
        title: viewer.loggedIn ? 'React' : 'Log in to react',
        onclick: async () => {
          if (!viewer.loggedIn) { location.href = loginHref(); return; }
          try {
            const { data } = await api(`/api/articles/${article.id}/react`, { method: 'POST', body: { emoji } });
            article.reactions[emoji] = data.count;
            article.myReactions = data.mine ? [...article.myReactions, emoji] : article.myReactions.filter((e) => e !== emoji);
            renderReactions();
          } catch (err) { alert(err.message); }
        },
      }, el('span', { textContent: emoji }), el('span', { className: 'count', textContent: String(article.reactions[emoji] || 0) }));
      btn.setAttribute('aria-pressed', String(mine));
      return btn;
    }));
  }

  // --- comments ------------------------------------------------------------------------
  function renderCommentForm() {
    const box = $('#commentForm');
    if (!viewer.loggedIn) {
      fill(box, el('p', { className: 'muted' }, 'Log in with Discord to join the discussion. ',
        viewer.loginEnabled ? el('a', { href: loginHref(), textContent: 'Log in' }) : null));
      return;
    }
    const text = el('textarea', { name: 'text', rows: 3, maxLength: 1000, required: true, placeholder: `Comment as ${viewer.name}…` });
    const form = el('form', { className: 'comment-form' }, text, el('button', { type: 'submit', className: 'primary', textContent: 'Post comment' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/articles/${article.id}/comments`, { method: 'POST', body: { text: text.value } });
        text.value = '';
        loadComments();
      } catch (err) { alert(err.message); }
    });
    box.replaceChildren(form);
  }

  async function loadComments() {
    const list = $('#commentList');
    try {
      const { data } = await api(`/api/articles/${article.id}/comments`);
      $('#comments h2').textContent = `Comments (${data.filter((c) => !c.hidden).length})`;
      if (!data.length) { list.replaceChildren(el('li', { className: 'muted', textContent: 'No comments yet. Be the first.' })); return; }
      list.replaceChildren(...data.map((c) => el('li', { className: `comment${c.hidden ? ' hidden-comment' : ''}` },
        el('img', { src: c.avatarUrl, alt: '', className: 'comment-avatar', referrerPolicy: 'no-referrer' }),
        el('div', { className: 'comment-main' },
          el('p', { className: 'comment-meta' }, el('strong', { textContent: c.userName }), ` · ${fmtDate(c.createdAt)}`,
            c.hidden ? el('em', { textContent: ` · hidden by ${c.hiddenBy || 'an editor'}` }) : null),
          el('p', { className: 'comment-text', textContent: c.text }),
          commentActions(c)))));
    } catch (err) {
      list.replaceChildren(el('li', { className: 'muted', textContent: `Could not load comments: ${err.message}` }));
    }
  }

  function commentActions(c) {
    const act = async (url, method, confirmText) => {
      if (confirmText && !confirm(confirmText)) return;
      try { await api(url, { method }); loadComments(); } catch (err) { alert(err.message); }
    };
    const base = `/api/articles/${article.id}/comments/${c.id}`;
    if (c.mine) return el('button', { type: 'button', className: 'link-btn', textContent: 'Delete', onclick: () => act(base, 'DELETE', 'Delete your comment?') });
    if (viewer.editor && c.hidden) return el('button', { type: 'button', className: 'link-btn', textContent: 'Restore', onclick: () => act(`${base}/restore`, 'POST') });
    if (viewer.editor) return el('button', { type: 'button', className: 'link-btn', textContent: 'Hide', onclick: () => act(base, 'DELETE', 'Hide this comment from readers?') });
    return null;
  }

  (async () => {
    try {
      viewer = await me;
      const { data } = await api(`/api/articles/${encodeURIComponent(slug)}`);
      article = data;
      renderArticle(article);
      renderReactions();
      if (article.status === 'published') {
        $('#comments').hidden = false;
        renderCommentForm();
        loadComments();
      }
    } catch (err) {
      $('#article').replaceChildren(el('h1', { textContent: 'Article not found' }),
        el('p', { className: 'muted' }, err.status === 404 ? 'This article does not exist or is not published yet. ' : `${err.message} `,
          el('a', { href: '/', textContent: 'Back to the front page' })));
    }
  })();
})();
