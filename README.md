# Outreach Desk

Outreach Desk is a standalone local application for researching companies and managing outbound worklists. It has its own SQLite database and starts with a sample wind and solar project. The starter list contains public company names, domains, and a few public professional profiles.

## Run

Use Node.js 24 or later. Run npm start from this folder, then open http://localhost:8282/. With the default SQLite store no packages are needed; to run against a Neon Postgres `DATABASE_URL`, run `npm install` first (it adds `pg`). The server listens on loopback. The database is data/outreach.sqlite. Set OUTREACH_DATA_DIR to use another storage directory and PORT to use another local port.

Before the first login, run `npm run reset-password` from this folder and choose a password of at least 10 characters. Log in as `admin`. The password is stored as a salted scrypt hash in `auth.json` inside the configured data directory.

The sidebar includes workspace settings, team, do-not-contact, integrations, and project creation. Each project has Today, Leads, Find leads, Import, Overview, Targeting, Analytics, Channels and Agents. A lead has Channels, People, Notes, History, Drafts and Enrichment tabs. Worklists use channel caps, cooldowns, suppressions, and either agent balancing or fixed quotas. Worklists generate on the first state load at or after 06:00 in the workspace time zone while the server is running.

Import accepts CSV, TSV, pasted domains, and the first worksheet of an XLSX workbook. Include a domain or website column, with optional company, country, category, contact name, designation, work email, LinkedIn, and description fields. Duplicate company domains are counted in the preview or import result.

To use web discovery and sourced enrichment, set EXA_API_KEY in the environment or in a local .env file and restart the app. Searches use the configured provider account. Without a key, Find leads searches the workspace's saved companies. Outreach actions copy drafts and open the channel for manual use. Team invitations are local pending records. Shared login, Gmail syncing, email digests, and the integrations marked Coming soon require separate provider and deployment work.

Set `FIRECRAWL_API_KEY` in the environment or local `.env` and restart to enable Firecrawl v2. Choose it explicitly in **Find leads**, or use **Find on site with Firecrawl** in a lead’s Enrichment tab. Each search requests up to 10 web results for 2 credits. Searches run one at a time and stop if the balance is unreadable or would fall below 105 credits. Select candidate company websites to import, or review and save a same-domain enrichment snippet with its source.

Set `PERPLEXITY_API_KEY` for Perplexity in **Find leads** and in a lead’s **Enrichment** tab. Set `LIMADATA_API_KEY` to enable **Find work email** in **People** for contacts without a saved email. Each lookup requires at least 4 LimaData credits. Review and save each match. LimaData is the source of the suggested address and deliverability remains unverified.

The local project has no dependency on 8181 or Kitfox. It does not send email or sync Gmail; the outreach actions produce drafts, copy text and open manually selected channels. Slack, Google Postmaster, HubSpot, Google Sheets sync and scheduled CSV export remain out of scope.

For a complete backup, stop `npm start` first, then copy the entire configured data directory, including `outreach.sqlite`, `auth.json` and any SQLite sidecar files. For example, with the default location, copy `data` to a separate backup location. To restore, stop the server, replace the configured data directory with that backup copy, and start the server again. The workspace, projects, leads, assignments, audit history and password state are stored there.

To enable Jev fit scoring, set `TYPESAFE_API_KEY` in the local server environment or `.env` and restart. The optional `TYPESAFE_MODEL` defaults to `jev-latest`. Save the project’s ideal customer and a company brief or reviewed fit evidence, then open the lead and select **Score with Jev**. TypeSafe receives the project targeting and saved company evidence. Each score is stored against that lead and targeting, with its original value out of 4. Edits to the scoring inputs require a fresh score. Outreach marks and assignments are independent of fit scores.

Run npm run check to validate the JavaScript.

## Known limitations / accepted risk

The browser-side XLSX/drag-and-drop import path is exercised through the Node import tests, including duplicate-domain counting and preview-versus-result behavior, but it has no DOM/browser test harness. The render error boundary is present and CSP-safe, but its runtime throw/reload behavior is not covered by an automated DOM test. Both remain open because closing them requires a DOM/browser harness such as jsdom or Playwright, which would break the app’s deliberate minimal-dependency policy, under which `pg` is currently the only approved exception (AGENTS.md §5).

## Contributing

Changes land on `main` through a pull request. `main` is protected: a PR is required, the **Verify** status check must pass, and the branch must be up to date with `main` before it can be merged. Force-pushes and branch deletions on `main` are blocked.

Recommended flow:

1. Start from the latest `main`: `git switch -c feat/<short-name>` (use `fix/`, `docs/`, etc. as appropriate).
2. Make and commit your changes.
3. Push the branch: `git push -u origin feat/<short-name>`.
4. Open a PR: `gh pr create --fill`.
5. Wait for **Verify** to pass, then merge: `gh pr merge --squash --delete-branch`.

Local setup and checks:

- `npm install` (only needed to add `pg` for Postgres; the SQLite path needs no packages).
- `npm run check` validates the JavaScript; `npm test` runs the suite. `npm run verify` runs both.
- Tests use the SQLite store and require no credentials or network.

The app reads `DATABASE_URL` when set (Neon Postgres) and falls back to the local SQLite file otherwise. `.env` and `node_modules/` are gitignored — never commit them or any secret. The `Outreach Desk` GitHub Actions workflow runs the **Verify** job on every push and pull request.

