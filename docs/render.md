# Hosting on Render

This project is a single Node.js process: Express serves static files and HTML routes, and Socket.IO handles real-time play. Render’s **Web Service** type fits that model and supports WebSocket upgrades, which Socket.IO relies on.

## Before you deploy

1. **Push the repo to GitHub (or GitLab / Bitbucket)** connected to Render.
2. **Include game data in the deployable tree.** The server expects SQLite at `data/clues.db` by default (see `lib/config.js`). If that file is not in your repository, either commit it (if size and licensing allow) or plan to attach a [Render Disk](https://render.com/docs/disks) and set `CLUES_DB_PATH` to a path on that volume.
3. **Commit `package-lock.json`** so Render installs the same dependency versions. The `sqlite3` package builds native code during `npm install`; Render’s Node build environment handles that.

## Create a Web Service

1. In the [Render Dashboard](https://dashboard.render.com), choose **New → Web Service**.
2. Connect the repository and pick the branch to deploy.
3. Use these settings:

   | Setting | Value |
   |--------|--------|
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance type** | Free or paid (see notes below) |

4. Render injects **`PORT`** automatically. Do not hard-code a port; the app already reads `process.env.PORT` via `lib/config.js`.

5. Add **environment variables** (Render → your service → **Environment**):

   | Name | Required | Notes |
   |------|----------|--------|
   | `PUBLIC_BASE_URL` | **Yes** for production | Set to your service’s public URL with **no trailing slash**, e.g. `https://your-service-name.onrender.com`. Players and room-code flows use this so links point at Render, not `localhost`. |
   | `OPENAI_API_KEY` | No | Only if you use OpenAI answer judging; see `.env.example`. |
   | `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` if unset. |
   | `OPENAI_ANSWER_JUDGE_ENABLED` | No | `true` / `false`; default in code is effectively on when a key is present—see `.env.example`. |
   | `CLUES_DB_PATH` | No | Only if the database file is not at `./data/clues.db` relative to the app root (e.g. on a mounted disk). |

   You can copy names and descriptions from `.env.example` for anything else you use locally.

6. **Health check** (optional): use path `/` if Render asks for one; the root route returns HTML.

7. Deploy. After the first successful deploy, open the service URL and use `/game`, `/player`, and `/home` as you do locally.

## Free tier and WebSockets

- On the **free** tier, the instance **spins down after idle**; the first request after sleep can take tens of seconds. Active Socket.IO sessions can drop when the process stops; for a stable game night, use a **paid** instance or keep the service awake.
- WebSockets work on Render Web Services; no special proxy flags are required for this app’s default Socket.IO setup.

## Data that changes on disk

Files such as `data/games_played.csv` and `data/game_high_score.csv` may be updated while the app runs. On a standard Web Service, the filesystem is **ephemeral**: redeploys replace the image, and you can lose those files unless you use a **persistent disk** and point the app at paths on that disk (e.g. set `CLUES_DB_PATH` and adjust any future config for CSV paths if you move them). The clues database is read for gameplay; if you never write to it in production, keeping a single committed `data/clues.db` is enough for many setups.

## Custom domain

In Render, add a **Custom Domain** and set `PUBLIC_BASE_URL` to the HTTPS URL you use in practice (e.g. `https://jeopardy.yourdomain.com`).

## Troubleshooting

- **Room codes or player links still show localhost** — `PUBLIC_BASE_URL` is missing or wrong; fix it and redeploy (or restart).
- **Build fails on `sqlite3`** — Ensure `package-lock.json` is committed and Node meets `engines` in `package.json` (≥ 18). Retry the deploy; transient build failures can be resolved with **Clear build cache & deploy**.
- **502 / app crashes on start** — Check **Logs** in Render; common causes are missing `data/clues.db` or an invalid `CLUES_DB_PATH`.
