// Shared by every page: helpers, theme, masthead, the account corner and article formatting.
(() => {
  const $ = (s, root = document) => root.querySelector(s);

  function el(tag, props = {}, ...kids) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
    return n;
  }

  /** replaceChildren that skips null/false entries (optional parts of a layout). */
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Server error (${res.status})`), { status: res.status });
    return { data, res };
  }

  const fmtDate = (iso, long = false) => (iso ? new Date(iso).toLocaleDateString(undefined, long
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  // --- article text: blank lines make paragraphs, "## " a subheading, "> " a quote,
  // **bold**, *italic* and [text](https://link). Built as DOM nodes, never as HTML.
  function inline(text) {
    const out = [];
    const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) out.push(el('strong', { textContent: m[1] }));
      else if (m[2]) out.push(el('em', { textContent: m[2] }));
      else out.push(el('a', { href: m[4], textContent: m[3], target: '_blank', rel: 'noopener noreferrer nofollow' }));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function renderBody(text) {
    const frag = document.createDocumentFragment();
    for (const block of String(text || '').split(/\n\s*\n/)) {
      const b = block.trim();
      if (!b) continue;
      if (b.startsWith('## ')) frag.append(el('h2', {}, inline(b.slice(3))));
      else if (b.startsWith('> ')) frag.append(el('blockquote', {}, inline(b.replace(/^>\s?/gm, ''))));
      else {
        const p = el('p');
        b.split('\n').forEach((line, i) => { if (i) p.append(el('br')); p.append(...inline(line)); });
        frag.append(p);
      }
    }
    return frag;
  }

  // --- badges next to names: staff titles as small labelled pills, newsroom roles as icons ---
  const ICONS = {
    Writer: ['M12 19l7-7 3 3-7 7-3-3z', 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z', 'M2 2l7.586 7.586', 'M13 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
    Editor: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
    Owner: ['M2.5 18.5h19L20 7.5l-5 4-3-7-3 7-5-4z'],
    Dev: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  };
  const TITLES = {
    Writer: 'Writer: writes articles for the paper',
    Editor: 'Editor: reviews and publishes articles',
    Owner: 'Owner of the paper',
    Dev: 'Developer of this site',
  };

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  /** Renders a user's badges. Roles (Writer, Editor) are icon-only; titles (Dev, Owner) show their name. */
  function badges(list, { labels = false } = {}) {
    if (!list || !list.length) return null;
    return el('span', { className: 'badges' }, list.map((b) => {
      const roleIcon = b === 'Writer' || b === 'Editor';
      const n = el('span', {
        className: `ubadge ubadge-${b.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${roleIcon && !labels ? ' ubadge-icon' : ''}`,
        title: TITLES[b] || b,
      }, ICONS[b] ? icon(b) : null, roleIcon && !labels ? el('span', { className: 'visually-hidden', textContent: b }) : b);
      return n;
    }));
  }

  /** A name followed by its badges. */
  const nameWithBadges = (name, list, tag = 'span') => el(tag, { className: 'who' }, el('span', { className: 'who-name', textContent: name }), badges(list));

  // --- theme ----------------------------------------------------------------------
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  function setTheme(dark) {
    const root = document.documentElement;
    root.classList.add('theme-fade');
    setTimeout(() => root.classList.remove('theme-fade'), 300);
    if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
  }

  // --- site info, masthead and account corner ----------------------------------------
  const site = fetch('/api/site').then((r) => r.json()).catch(() => ({ name: 'News', categories: [], reactions: [] }));
  const me = fetch('/api/me').then((r) => r.json()).catch(() => ({ loggedIn: false }));

  const loginHref = () => `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;

  site.then((s) => {
    document.querySelectorAll('[data-outlet-name]').forEach((n) => { n.textContent = s.name; });
    if (!document.title.includes(s.name)) document.title = document.title ? `${document.title} — ${s.name}` : s.name;
  });
  document.querySelectorAll('[data-today]').forEach((n) => { n.textContent = fmtDate(new Date().toISOString(), true); });

  async function renderAccount() {
    const box = $('#account');
    if (!box) return;
    const m = await me;
    const themeLabel = () => (isDark() ? 'Light mode' : 'Dark mode');
    if (!m.loggedIn) {
      const themeBtn = el('button', { className: 'btn', type: 'button', textContent: themeLabel() });
      themeBtn.onclick = () => { setTheme(!isDark()); themeBtn.textContent = themeLabel(); };
      box.replaceChildren(el('div', { className: 'account-out' }, themeBtn,
        m.loginEnabled ? el('a', { className: 'btn', href: loginHref(), textContent: 'Log in with Discord' }) : null));
      return;
    }
    const themeItem = el('button', { className: 'menu-item', type: 'button', textContent: themeLabel() });
    themeItem.onclick = () => { setTheme(!isDark()); themeItem.textContent = themeLabel(); };
    const menu = el('div', { className: 'menu' },
      el('div', { className: 'menu-user' }, el('span', { className: 'name', textContent: m.name }),
        badges(m.badges, { labels: true })),
      m.writer ? el('a', { className: 'menu-item', href: '/newsroom.html', textContent: 'Newsroom' }) : null,
      themeItem,
      el('button', {
        className: 'menu-item', type: 'button', textContent: 'Log out',
        onclick: async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); },
      }));
    const toggle = el('button', { className: 'avatar-btn', type: 'button', title: 'Account menu' },
      el('img', { src: m.avatarUrl, alt: `${m.name}'s Discord avatar`, referrerPolicy: 'no-referrer' }));
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    const setOpen = (open) => { menu.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
    toggle.onclick = (e) => { e.stopPropagation(); setOpen(!menu.classList.contains('open')); };
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    box.replaceChildren(toggle, menu);
  }

  // Category links in the masthead nav.
  async function renderNav() {
    const nav = $('#sections');
    if (!nav) return;
    const s = await site;
    const current = new URLSearchParams(location.search).get('category') || '';
    const onHome = location.pathname === '/' || location.pathname.endsWith('index.html');
    const link = (label, value) => el('a', {
      href: value ? `/?category=${encodeURIComponent(value)}` : '/',
      textContent: label,
      className: onHome && current === value ? 'active' : '',
    });
    nav.replaceChildren(link('Front page', ''), ...s.categories.map((c) => link(c, c)));
  }

  renderAccount();
  renderNav();

  window.News = { $, el, fill, api, badges, nameWithBadges, fmtDate, renderBody, site, me, loginHref };
})();
