// Newsroom: writers draft and submit articles; editors review, publish and manage writers.
(() => {
  const { $, el, fill, api, fmtDate, renderBody, me, site, loginHref } = window.News;
  const form = $('#articleForm');
  let viewer = null;
  let editing = null; // the article being edited, or null for a new one
  let data = { mine: [], queue: [], all: [] };

  const STATUS_LABEL = { draft: 'Draft', submitted: 'Waiting for review', rejected: 'Sent back', published: 'Published' };

  function setStatus(text) { $('#newsroomStatus').textContent = text; $('#newsroomStatus').hidden = !text; }

  // --- the editor form ---------------------------------------------------------------
  function fillForm(a) {
    editing = a;
    for (const f of ['title', 'category', 'image', 'imageCaption', 'summary', 'body']) form.elements[f].value = a ? a[f] || '' : '';
    if (!a) form.elements.category.selectedIndex = 0;
    $('#editorTitle').textContent = a ? `Editing: ${a.title}` : 'Write a new article';
    form.querySelector('button[type=submit]').textContent = a ? 'Save changes' : 'Save draft';
    $('#cancelEdit').hidden = !a;
    $('#preview').hidden = true;
    $('#previewBtn').textContent = 'Preview';
  }

  const formValues = () => Object.fromEntries(['title', 'category', 'image', 'imageCaption', 'summary', 'body'].map((f) => [f, form.elements[f].value]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { data: saved } = editing
        ? await api(`/api/articles/${editing.id}`, { method: 'PUT', body: formValues() })
        : await api('/api/articles', { method: 'POST', body: formValues() });
      fillForm(null);
      await load();
      flash(`Saved “${saved.title}”.${saved.status === 'draft' ? ' Submit it for review when it’s ready.' : ''}`);
    } catch (err) { alert(err.message); }
  });

  $('#cancelEdit').addEventListener('click', () => fillForm(null));

  $('#previewBtn').addEventListener('click', () => {
    const p = $('#preview');
    p.hidden = !p.hidden;
    $('#previewBtn').textContent = p.hidden ? 'Preview' : 'Hide preview';
    if (p.hidden) return;
    const v = formValues();
    fill(p, el('p', { className: 'kicker', textContent: v.category }), el('h1', { textContent: v.title || 'Headline' }),
      v.summary ? el('p', { className: 'standfirst', textContent: v.summary }) : null, renderBody(v.body));
  });

  function flash(text) {
    const n = el('p', { className: 'flash', textContent: text });
    $('#editorPanel').prepend(n);
    setTimeout(() => n.remove(), 5000);
  }

  // --- article lists ---------------------------------------------------------------------
  async function act(a, action, confirmText, body) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      if (action === 'delete') await api(`/api/articles/${a.id}`, { method: 'DELETE' });
      else await api(`/api/articles/${a.id}/${action}`, { method: 'POST', body: body || {} });
      if (editing && editing.id === a.id) fillForm(null);
      await load();
    } catch (err) { alert(err.message); }
  }

  function storyRow(a, context) {
    const mine = a.authorId === viewer.id;
    const btn = (label, onclick, cls = '') => el('button', { type: 'button', className: cls, textContent: label, onclick });
    const actions = [];
    if (a.status === 'published' || viewer.editor || mine) actions.push(el('a', { href: `/article.html?slug=${encodeURIComponent(a.slug)}`, textContent: a.status === 'published' ? 'View' : 'Preview' }));
    if (viewer.editor || (mine && a.status !== 'published')) actions.push(btn('Edit', () => { fillForm(a); $('#editorPanel').scrollIntoView(); }));
    if (mine && ['draft', 'rejected'].includes(a.status)) actions.push(btn('Submit for review', () => act(a, 'submit'), 'primary'));
    if (mine && a.status === 'submitted' && context === 'mine') actions.push(btn('Withdraw', () => act(a, 'withdraw')));
    if (viewer.editor && a.status !== 'published') actions.push(btn('Publish', () => act(a, 'publish', `Publish “${a.title}” now?`), 'primary'));
    if (viewer.editor && a.status === 'submitted') {
      actions.push(btn('Send back', () => {
        const note = prompt('What needs changing? (the writer will see this)');
        if (note !== null) act(a, 'reject', null, { note });
      }));
    }
    if (viewer.editor && a.status === 'published') actions.push(btn('Unpublish', () => act(a, 'unpublish', `Take “${a.title}” off the site?`)));
    if (viewer.editor || (mine && a.status !== 'published')) actions.push(btn('Delete', () => act(a, 'delete', `Delete “${a.title}” permanently?`), 'danger'));

    return el('li', {},
      el('div', { className: 'story-row-main' },
        el('span', { className: `status status-${a.status}`, textContent: STATUS_LABEL[a.status] || a.status }),
        el('strong', { textContent: a.title }),
        el('span', { className: 'muted', textContent: ` · ${a.category} · by ${a.authorName} · updated ${fmtDate(a.updatedAt)}` }),
        a.status === 'rejected' && a.editorNote ? el('p', { className: 'editor-note', textContent: `Editor’s note: ${a.editorNote}` }) : null),
      el('div', { className: 'row-actions' }, ...actions));
  }

  function fillList(id, items, context, empty) {
    $(id).replaceChildren(...(items.length ? items.map((a) => storyRow(a, context)) : [el('li', { className: 'muted', textContent: empty })]));
  }

  async function load() {
    const { data: d } = await api('/api/newsroom');
    data = d;
    fillList('#mine', data.mine, 'mine', 'You haven’t written anything yet. Start with the form above.');
    if (viewer.editor) {
      fillList('#queue', data.queue, 'queue', 'Nothing waiting for review.');
      fillList('#all', data.all, 'all', 'No articles yet.');
      loadWriters();
    }
  }

  // --- writers (editors only) ---------------------------------------------------------------
  async function loadWriters() {
    const { data: writers } = await api('/api/writers');
    $('#writers').replaceChildren(...(writers.length ? writers.map((w) => el('li', {},
      el('span', {}, el('strong', { textContent: w.name }), el('span', { className: 'muted', textContent: ` · ${w.id} · added by ${w.addedBy}` })),
      el('button', {
        type: 'button', className: 'danger', textContent: 'Remove',
        onclick: async () => {
          if (!confirm(`Remove ${w.name} as a writer? Their articles stay.`)) return;
          try { await api(`/api/writers/${w.id}`, { method: 'DELETE' }); loadWriters(); } catch (err) { alert(err.message); }
        },
      }))) : [el('li', { className: 'muted', textContent: 'No writers yet. Editors can always write.' })]));
  }

  $('#writerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/writers', { method: 'POST', body: { id: f.elements.id.value.trim(), name: f.elements.name.value.trim() } });
      f.reset();
      loadWriters();
    } catch (err) { alert(err.message); }
  });

  // --- start -------------------------------------------------------------------------------------
  (async () => {
    viewer = await me;
    if (!viewer.loggedIn) {
      fill($('#newsroomStatus'), 'The newsroom is for writers and editors. ',
        viewer.loginEnabled ? el('a', { href: loginHref(), textContent: 'Log in with Discord' }) : null);
      return;
    }
    if (!viewer.writer) {
      setStatus(`You're logged in as ${viewer.name}, but you're not a writer yet. Ask an editor to add your Discord ID.`);
      return;
    }
    const s = await site;
    form.elements.category.replaceChildren(...s.categories.map((c) => el('option', { value: c, textContent: c })));
    document.querySelectorAll('.editor-only').forEach((n) => { n.hidden = !viewer.editor; });
    setStatus('');
    $('#newsroomBody').hidden = false;
    try {
      await load();
      const editId = new URLSearchParams(location.search).get('edit');
      const target = editId && [...data.mine, ...data.all].find((a) => a.id === editId);
      if (target) fillForm(target);
    } catch (err) { setStatus(`Could not load the newsroom: ${err.message}`); }
  })();
})();
