# TurboReplies Email Automation

Local Node.js + TypeScript CLI that reads a local CSV of leads, optionally checks IMAP replies, sends outreach emails through Resend, and updates the same CSV after successful sends. No Google account or cloud setup required.

## What it does

- Reads leads from a local CSV file (`leads.csv` by default).
- Optionally checks IMAP replies before sending follow-ups.
- Sends first emails and follow-ups through Resend.
- Writes status, dates, follow-up step, and notes back to the CSV after each successful send.
- Supports `dry-run` mode that sends nothing and writes nothing.

## Files

- `package.json`
- `tsconfig.json`
- `.env.example`
- `leads.csv` — your lead data (git-ignored; contains contact PII)
- `leads.example.csv` — the column schema with sample rows
- `src/index.ts`
- `src/csvStore.ts`
- `src/templates.ts`
- `src/resendClient.ts`
- `src/imapReplies.ts`
- `src/outreach.ts`
- `src/draft.ts`
- `src/types.ts`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your values (Resend key, sender, IMAP if used).

3. Copy `leads.example.csv` to `leads.csv` and add your leads (or edit `leads.csv` directly).

## The CSV

`leads.csv` lives at the repo root and is git-ignored because it holds contact PII. `leads.example.csv` is tracked and documents the exact columns. The header row must contain these columns (order is flexible; `Property/Business` is also accepted for `Property`):

`Property`, `Location`, `Village`, `Language`, `Owner`, `Email`, `Phone/WhatsApp`, `Instagram`, `Hook`, `Primary Channel`, `Status`, `Date sent`, `Next Follow-up`, `Follow-up Step`, `Replied?`, `Do Not Contact?`, `Notes`, and the optional `Vertical`.

Edit it in any spreadsheet app or text editor — just don't hand-edit it *during* a `send` run, since the tool rewrites the file on each update. Fields with commas or newlines must be quoted (standard CSV); most editors do this automatically.

## Required environment variables

```env
OUTREACH_CSV_PATH=leads.csv
RESEND_API_KEY=
OUTREACH_FROM_EMAIL=hello@turboreplies.com
OUTREACH_FROM_NAME=Federico | TurboReplies
OUTREACH_REPLY_TO=hello@turboreplies.com
OUTREACH_DEMO_URL=https://www.turboreplies.com/en
ANTHROPIC_API_KEY=
CHECK_REPLIES=false
ALLOW_SEND_IF_IMAP_FAILS=false
IMAP_HOST=mail.privateemail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=hello@turboreplies.com
IMAP_PASS=
```

`OUTREACH_CSV_PATH` defaults to `leads.csv` (resolved from the repo root). `IMAP_*` values are required only when `CHECK_REPLIES=true`. `ANTHROPIC_API_KEY` is required only for `npm run add` (uses Claude to draft the `Hook`); `ANTHROPIC_MODEL` optionally overrides the model (default `claude-opus-4-8`).

`OUTREACH_DEMO_URL` is the base of the interactive demo link embedded in every email. It defaults to `https://www.turboreplies.com/en`. The tool rewrites the locale segment to match each row's `Language` (supported: `en`, `it`, `fr`, `de`, `es`; anything else falls back to `en`), appends the `vertical` deep-link param plus UTM tags, and adds the `#interactive-demos` anchor. Email body copy is written in Italian for Italian rows and English for everything else; non-English/Italian recipients still get a demo page localized to their language.

## Verticals (optional `Vertical` column)

Add an optional `Vertical` column to tailor the copy and the demo deep link per row. It is read by header name when present, is never required, and is never written back, so a CSV without it keeps working unchanged (blank defaults to `hotel`).

Recognized values (case-insensitive, matched loosely):

- `clinic` / `dental` / `medical` -> medical & dental copy, demo `vertical=clinic`
- `real-estate` / `immobiliare` / `agenzia` -> real estate copy, demo `vertical=real-estate`
- `hotel` / `hospitality` / `hostel` / blank -> hospitality copy, demo `vertical=hotel`

The demo link slug and locale always stay in sync with the website's accepted values, so the page opens on the matching workflow and the contact form preselects the right business type.

## Commands

Dry run:

```bash
npm run dry-run
```

This prints each eligible email preview and the row changes that would happen. It does not send emails and does not update the CSV.

Send:

```bash
npm run send
```

This sends through Resend and updates the CSV only after each successful send. If a send fails, that row is not marked as sent.

Draft (manual first outreach):

```bash
npm run draft
```

This renders the first outreach email for every contactable lead (has `Email`, not `Replied?`, not `Do Not Contact?`) so you can copy-paste and send by hand. It reads only — sends nothing, writes nothing. See `OUTREACH_PLAYBOOK.md` for the full process.

Add a lead from a URL:

```bash
npm run add https://example-clinic.it
```

Fetches the site, uses Claude to infer the business name, vertical, language, and a personal `Hook`, extracts the contact email/phone/Instagram, shows a preview of the first email, and appends a ready-to-send `To do` row to `leads.csv` after you confirm. Requires `ANTHROPIC_API_KEY`. Verify the email it picked before sending.

## Workflow rules implemented

- First email:
  - `Status = To do`
  - `Follow-up Step = 0`
  - `Email` must exist
  - `Replied?` must not be `TRUE`
  - `Do Not Contact?` must not be `TRUE`
- Follow-up 1:
  - `Status = Active`
  - `Follow-up Step = 1`
  - `Next Follow-up` is today or earlier
  - if `Next Follow-up` is blank, the tool falls back to `Date sent + 3 days`
- Follow-up 2:
  - `Status = Active`
  - `Follow-up Step = 2`
  - `Next Follow-up` is today or earlier
  - if `Next Follow-up` is blank, the tool falls back to `Date sent + 7 days`
- Follow-up 3:
  - `Status = Active`
  - `Follow-up Step = 3`
  - `Next Follow-up` is today or earlier
  - if `Next Follow-up` is blank, the tool falls back to `Date sent + 14 days`
- Never send:
  - when `Email` is empty
  - when `Replied? = TRUE`
  - when `Do Not Contact? = TRUE`
  - when `Status` is `Needs reply`, `Interested`, `Not interested`, or `Bad fit`
## IMAP reply detection

When `CHECK_REPLIES=true`, the tool connects to IMAP before sending anything.

For rows where:

- `Status = Active`
- `Replied?` is not `TRUE`

it searches the IMAP inbox for messages from the row email address and only counts messages dated after `Date sent`.
For newly sent emails, it also embeds a stable thread token in the subject so replies can still be detected even when the sender responds from a different address.

If a reply is found:

- `Status` becomes `Needs reply`
- `Replied?` becomes `TRUE`
- `Next Follow-up` is cleared
- `Follow-up Step` becomes `Done`
- a timestamped note is appended
- no follow-up is sent for that row

If IMAP fails:

- in `dry-run`, the tool logs a warning and continues
- in `send`, the tool stops before sending unless `ALLOW_SEND_IF_IMAP_FAILS=true`
