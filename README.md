# News Outlet

A newspaper website for the **Democracy Craft** Minecraft server, in the same muted sepia style as the
Student Archive.

- **Front page and sections**: the latest lead story plus the rest in newspaper columns, with sections
  (Politics, Courts & Law, Business & Economy, Opinion, Community, Events) and search.
- **Articles**: headline, summary, optional image, and simple formatting (paragraphs, `## subheadings`,
  `> quotes`, `**bold**`, `*italic*`, `[links](https://…)`).
- **Newsroom** (`/newsroom.html`): writers draft articles and submit them for review; editors publish,
  send back with a note, unpublish or delete, and add or remove writers by Discord ID.
- **Comments and reactions**: logged-in readers can comment and react; editors can hide comments.
- Discord login, dark mode, works on phones.

Built with plain HTML/CSS/JS and a small Node + Express backend.

## Run locally

```sh
npm install
npm start
```

Then open http://localhost:3000. Without Redis, data is kept in `data/db.json`.

## Deploy to Vercel

1. Import the repo in Vercel (it runs `server.js` directly; no `vercel.json` needed).
2. In the project's **Storage** tab, add an **Upstash Redis** database with the prefix `KV`
   (sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Add a Discord OAuth redirect `https://<your-domain>/auth/callback` in the Discord developer portal.
4. Set these environment variables, then redeploy:

| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord app credentials |
| `DISCORD_REDIRECT_URI` | `https://<your-domain>/auth/callback` |
| `SESSION_SECRET` | Long random string used to sign login cookies |
| `EDITOR_DISCORD_IDS` | Comma-separated Discord user IDs of the editors |
| `OUTLET_NAME` | The newspaper's name shown in the masthead (default "The Redmont Gazette") |

The three sample articles are marked "Sample" and can be deleted by an editor from the newsroom.

## License

MIT, see [LICENSE](LICENSE).
