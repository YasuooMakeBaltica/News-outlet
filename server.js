const crypto = require('crypto');
const express = require('express');
const path = require('path');

const { router: authRouter, getUser, isEditor, avatarUrl, loginEnabled } = require('./auth');
const { store, StorageUnavailable } = require('./store');

const PORT = process.env.PORT || 3000;
// The masthead name. The client is still choosing one, so it is a setting rather than code.
const OUTLET_NAME = process.env.OUTLET_NAME || 'The Redmont Gazette';
const CATEGORIES = ['Politics', 'Courts & Law', 'Business & Economy', 'Opinion', 'Community', 'Events'];
const REACTIONS = ['👍', '❤️', '😮', '😂', '😡'];
// Required (not read at runtime) so Vercel bundles the sample articles with the function.
const SEED = require('./data/seed.json');

// --- helpers -------------------------------------------------------------------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const newId = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');
const slugify = (title, id) => `${str(title, 80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'article'}-${id}`;
const readingMinutes = (body) => Math.max(1, Math.round(String(body || '').split(/\s+/).filter(Boolean).length / 200));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  if (err instanceof StorageUnavailable) {
    return res.status(503).json({ error: 'Saving is not set up on this server: connect an Upstash Redis database.' });
  }
  res.status(500).json({ error: 'Something went wrong.' });
});

let seeded = null;
const ensureSeeded = () => (seeded ||= store.seed('articles', SEED.articles).catch((err) => { seeded = null; throw err; }));

async function roles(req) {
  const user = getUser(req);
  if (!user) return { user: null, editor: false, writer: false };
  const editor = isEditor(user);
  const writer = editor || !!(await store.get('writers', user.id));
  return { user, editor, writer };
}

const needLogin = (r, res) => (r.user ? false : (res.status(401).json({ error: 'Log in with Discord first.' }), true));
const needWriter = (r, res) => (r.writer ? false : (res.status(403).json({ error: 'Only writers can do that.' }), true));
const needEditor = (r, res) => (r.editor ? false : (res.status(403).json({ error: 'Only editors can do that.' }), true));

function cleanArticle(body) {
  const image = str(body.image, 400);
  return {
    title: str(body.title, 140),
    summary: str(body.summary, 300),
    body: str(body.body, 20000),
    category: CATEGORIES.includes(body.category) ? body.category : CATEGORIES[0],
    image: /^https:\/\//i.test(image) ? image : '',
    imageCaption: str(body.imageCaption, 160),
  };
}

/** Public shape of an article; drafts' editor notes only go to people who may see the draft. */
function present(a, { full = false } = {}) {
  const out = {
    id: a.id, slug: a.slug, title: a.title, summary: a.summary, category: a.category,
    image: a.image, imageCaption: a.imageCaption, authorName: a.authorName,
    status: a.status, publishedAt: a.publishedAt, updatedAt: a.updatedAt,
    readingMinutes: readingMinutes(a.body), commentCount: a.commentCount || 0, example: !!a.example,
  };
  if (full) Object.assign(out, { body: a.body, editorNote: a.editorNote || '', createdAt: a.createdAt, submittedAt: a.submittedAt, authorId: a.authorId });
  return out;
}

const canSee = (a, r) => a.status === 'published' || r.editor || (r.user && a.authorId === r.user.id);

async function findArticle(idOrSlug) {
  await ensureSeeded();
  const direct = await store.get('articles', idOrSlug);
  if (direct) return direct;
  return Object.values(await store.all('articles')).find((a) => a.slug === idOrSlug) || null;
}

// --- app -------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(authRouter);

app.get('/api/site', (req, res) => res.json({ name: OUTLET_NAME, categories: CATEGORIES, reactions: REACTIONS }));

app.get('/api/me', wrap(async (req, res) => {
  const r = await roles(req);
  res.json({
    loggedIn: !!r.user,
    id: r.user ? r.user.id : null,
    name: r.user ? r.user.name : null,
    avatarUrl: r.user ? avatarUrl(r.user) : null,
    editor: r.editor,
    writer: r.writer,
    loginEnabled,
  });
}));

// Front page and sections: published articles, newest first.
app.get('/api/articles', wrap(async (req, res) => {
  await ensureSeeded();
  const q = str(req.query.q, 100).toLowerCase();
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const items = Object.values(await store.all('articles'))
    .filter((a) => a.status === 'published' && (!category || a.category === category))
    .filter((a) => !q || [a.title, a.summary, a.body, a.authorName].some((s) => String(s || '').toLowerCase().includes(q)))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 13, 1), 50);
  res.set('X-Total-Count', String(items.length));
  res.json(items.slice(offset, offset + limit).map((a) => present(a)));
}));

app.get('/api/articles/:slug', wrap(async (req, res) => {
  const r = await roles(req);
  const a = await findArticle(req.params.slug);
  if (!a || !canSee(a, r)) return res.status(404).json({ error: 'Article not found.' });
  const reactions = await store.all(`reactions:${a.id}`);
  res.json({
    ...present(a, { full: true }),
    reactions: Object.fromEntries(REACTIONS.map((e) => [e, (reactions[e] || []).length])),
    myReactions: r.user ? REACTIONS.filter((e) => (reactions[e] || []).includes(r.user.id)) : [],
    canEdit: r.editor || (!!r.user && a.authorId === r.user.id && a.status !== 'published'),
  });
}));

// --- newsroom: writing, submitting and publishing -------------------------------------
app.get('/api/newsroom', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needWriter(r, res)) return;
  await ensureSeeded();
  const all = Object.values(await store.all('articles'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({
    mine: all.filter((a) => a.authorId === r.user.id).map((a) => present(a, { full: true })),
    queue: r.editor ? all.filter((a) => a.status === 'submitted').map((a) => present(a, { full: true })) : [],
    all: r.editor ? all.map((a) => present(a, { full: true })) : [],
  });
}));

app.post('/api/articles', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needWriter(r, res)) return;
  const fields = cleanArticle(req.body || {});
  if (!fields.title || !fields.body) return res.status(400).json({ error: 'A headline and article text are required.' });
  const id = newId();
  const now = new Date().toISOString();
  const article = {
    id, slug: slugify(fields.title, id), ...fields,
    authorId: r.user.id, authorName: r.user.name, status: 'draft',
    createdAt: now, updatedAt: now, commentCount: 0,
  };
  await store.set('articles', id, article);
  res.status(201).json(present(article, { full: true }));
}));

app.put('/api/articles/:id', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const a = await store.get('articles', req.params.id);
  if (!a) return res.status(404).json({ error: 'Article not found.' });
  const isAuthor = a.authorId === r.user.id && r.writer;
  if (!r.editor && !(isAuthor && a.status !== 'published')) {
    return res.status(403).json({ error: a.status === 'published' ? 'Only editors can change a published article.' : 'You can only edit your own articles.' });
  }
  const fields = cleanArticle(req.body || {});
  if (!fields.title || !fields.body) return res.status(400).json({ error: 'A headline and article text are required.' });
  Object.assign(a, fields, { updatedAt: new Date().toISOString() });
  if (a.status !== 'published') a.slug = slugify(a.title, a.id); // links only change before publication
  await store.set('articles', a.id, a);
  res.json(present(a, { full: true }));
}));

// Status changes: submit (author), publish / reject / unpublish (editor).
const transitions = {
  submit: { who: 'author', from: ['draft', 'rejected'], to: 'submitted' },
  withdraw: { who: 'author', from: ['submitted'], to: 'draft' },
  publish: { who: 'editor', from: ['draft', 'submitted', 'rejected'], to: 'published' },
  reject: { who: 'editor', from: ['submitted'], to: 'rejected' },
  unpublish: { who: 'editor', from: ['published'], to: 'draft' },
};
app.post('/api/articles/:id/:action(submit|withdraw|publish|reject|unpublish)', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const t = transitions[req.params.action];
  const a = await store.get('articles', req.params.id);
  if (!a) return res.status(404).json({ error: 'Article not found.' });
  if (t.who === 'editor' && needEditor(r, res)) return;
  if (t.who === 'author' && a.authorId !== r.user.id) return res.status(403).json({ error: 'You can only do that to your own articles.' });
  if (!t.from.includes(a.status)) return res.status(409).json({ error: `Can't ${req.params.action} an article that is ${a.status}.` });
  const now = new Date().toISOString();
  a.status = t.to;
  a.updatedAt = now;
  if (t.to === 'submitted') { a.submittedAt = now; a.editorNote = ''; }
  if (t.to === 'published') { a.publishedAt = a.publishedAt || now; a.publishedBy = r.user.name; a.editorNote = ''; }
  if (req.params.action === 'reject') a.editorNote = str((req.body || {}).note, 500) || 'Needs changes.';
  await store.set('articles', a.id, a);
  res.json(present(a, { full: true }));
}));

app.delete('/api/articles/:id', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const a = await store.get('articles', req.params.id);
  if (!a) return res.status(404).json({ error: 'Article not found.' });
  if (!r.editor && !(a.authorId === r.user.id && a.status !== 'published')) {
    return res.status(403).json({ error: 'Only editors can delete published articles.' });
  }
  await store.del('articles', a.id);
  await store.drop(`comments:${a.id}`);
  await store.drop(`reactions:${a.id}`);
  res.json({ ok: true });
}));

// --- writers (managed by editors) ------------------------------------------------------
app.get('/api/writers', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needEditor(r, res)) return;
  res.json(Object.values(await store.all('writers')).sort((a, b) => a.name.localeCompare(b.name)));
}));

app.post('/api/writers', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needEditor(r, res)) return;
  const id = str((req.body || {}).id, 25);
  const name = str((req.body || {}).name, 60);
  if (!/^\d{15,22}$/.test(id)) return res.status(400).json({ error: 'Enter the writer\'s Discord user ID (a long number).' });
  if (!name) return res.status(400).json({ error: 'Enter a name so you can recognise them.' });
  const writer = { id, name, addedBy: r.user.name, addedAt: new Date().toISOString() };
  await store.set('writers', id, writer);
  res.status(201).json(writer);
}));

app.delete('/api/writers/:id', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needEditor(r, res)) return;
  await store.del('writers', req.params.id);
  res.json({ ok: true });
}));

// --- comments & reactions (logged-in readers) ---------------------------------------------
const lastComment = new Map(); // userId -> time, a simple per-instance flood guard

app.get('/api/articles/:id/comments', wrap(async (req, res) => {
  const r = await roles(req);
  const a = await store.get('articles', req.params.id);
  if (!a || !canSee(a, r)) return res.status(404).json({ error: 'Article not found.' });
  const comments = Object.values(await store.all(`comments:${a.id}`))
    .filter((c) => !c.hidden || r.editor)
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    .map((c) => ({ ...c, mine: !!r.user && c.userId === r.user.id, userId: undefined }));
  res.json(comments);
}));

async function recount(articleId) {
  const a = await store.get('articles', articleId);
  if (!a) return;
  a.commentCount = Object.values(await store.all(`comments:${articleId}`)).filter((c) => !c.hidden).length;
  await store.set('articles', articleId, a);
}

app.post('/api/articles/:id/comments', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const a = await store.get('articles', req.params.id);
  if (!a || a.status !== 'published') return res.status(404).json({ error: 'Article not found.' });
  const text = str((req.body || {}).text, 1000);
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  const last = lastComment.get(r.user.id) || 0;
  if (Date.now() - last < 15000) return res.status(429).json({ error: 'Please wait a few seconds before commenting again.' });
  lastComment.set(r.user.id, Date.now());
  const comment = {
    id: newId(), userId: r.user.id, userName: r.user.name, avatarUrl: avatarUrl(r.user),
    text, createdAt: new Date().toISOString(), hidden: false,
  };
  await store.set(`comments:${a.id}`, comment.id, comment);
  await recount(a.id);
  res.status(201).json({ ...comment, mine: true, userId: undefined });
}));

// Readers delete their own comments; editors hide (and can restore) anyone's.
app.delete('/api/articles/:id/comments/:commentId', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const c = await store.get(`comments:${req.params.id}`, req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.userId === r.user.id) await store.del(`comments:${req.params.id}`, c.id);
  else if (r.editor) await store.set(`comments:${req.params.id}`, c.id, { ...c, hidden: true, hiddenBy: r.user.name });
  else return res.status(403).json({ error: 'You can only delete your own comments.' });
  await recount(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/articles/:id/comments/:commentId/restore', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res) || needEditor(r, res)) return;
  const c = await store.get(`comments:${req.params.id}`, req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  await store.set(`comments:${req.params.id}`, c.id, { ...c, hidden: false, hiddenBy: undefined });
  await recount(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/articles/:id/react', wrap(async (req, res) => {
  const r = await roles(req);
  if (needLogin(r, res)) return;
  const emoji = (req.body || {}).emoji;
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction.' });
  const a = await store.get('articles', req.params.id);
  if (!a || a.status !== 'published') return res.status(404).json({ error: 'Article not found.' });
  const users = (await store.get(`reactions:${a.id}`, emoji)) || [];
  const next = users.includes(r.user.id) ? users.filter((u) => u !== r.user.id) : [...users, r.user.id];
  await store.set(`reactions:${a.id}`, emoji, next);
  res.json({ emoji, count: next.length, mine: next.includes(r.user.id) });
}));

if (require.main === module) {
  app.listen(PORT, () => console.log(`${OUTLET_NAME} running at http://localhost:${PORT}`));
}

module.exports = app;
