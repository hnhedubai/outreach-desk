# Outreach Desk

Outreach Desk is a standalone local application for researching companies and managing outbound worklists. It has its own SQLite database and starts with a sample wind and solar project. The starter list contains public company names, domains, and a few public professional profiles.

## Run

Use Node.js 24 or later. Run npm start from this folder, then open http://localhost:8282/. No package installation is required. The server listens on loopback. The database is data/outreach.sqlite. Set OUTREACH_DATA_DIR to use another storage directory and PORT to use another local port.

The sidebar includes workspace settings, team, do-not-contact, integrations, and project creation. Each project has Today, Leads, Find leads, Import, Overview, Targeting, Analytics, Channels and Agents. A lead has Channels, People, Notes, History, Drafts and Enrichment tabs. Worklists use channel caps, cooldowns, suppressions, and either agent balancing or fixed quotas. Worklists generate on the first state load at or after 06:00 in the workspace time zone while the server is running.

Import accepts CSV, TSV, pasted domains, and the first worksheet of an XLSX workbook. Include a domain or website column, with optional company, country, category, contact name, designation, work email, LinkedIn, and description fields. Duplicate company domains are counted in the preview or import result.

To use web discovery and sourced enrichment, set EXA_API_KEY in the environment or in a local .env file and restart the app. Searches use the configured provider account. Without a key, Find leads searches the workspace's saved companies. Outreach actions copy drafts and open the channel for manual use. Team invitations are local pending records. Shared login, Gmail syncing, email digests, and the integrations marked Coming soon require separate provider and deployment work.

Set `FIRECRAWL_API_KEY` in the environment or local `.env` and restart to enable Firecrawl v2. Choose it explicitly in **Find leads**, or use **Find on site with Firecrawl** in a lead’s Enrichment tab. Each search requests up to 10 web results for 2 credits. Searches run one at a time and stop if the balance is unreadable or would fall below 105 credits. Select candidate company websites to import, or review and save a same-domain enrichment snippet with its source.

Set `PERPLEXITY_API_KEY` for Perplexity in **Find leads** and in a lead’s **Enrichment** tab. Set `LIMADATA_API_KEY` to enable **Find work email** in **People** for contacts without a saved email. Review and save each match. LimaData is the source of the suggested address and deliverability remains unverified.

The local project has no dependency on 8181 or Kitfox. For backups, stop the server and copy the data directory.

To enable Jev fit scoring, set `TYPESAFE_API_KEY` in the local server environment or `.env` and restart. The optional `TYPESAFE_MODEL` defaults to `jev-latest`. Save the project’s ideal customer and a company brief or reviewed fit evidence, then open the lead and select **Score with Jev**. TypeSafe receives the project targeting and saved company evidence. Each score is stored against that lead and targeting, with its original value out of 4. Edits to the scoring inputs require a fresh score. Outreach marks and assignments are independent of fit scores.

Run npm run check to validate the JavaScript.

