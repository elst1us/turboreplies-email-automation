# TurboReplies Email Automation

Local Node.js + TypeScript CLI that reads your existing Google Sheet, optionally checks IMAP replies, sends outreach emails through Resend, and updates the same sheet after successful sends.

## What it does

- Reads the existing Google Sheet directly through the Google Sheets API.
- Never recreates the sheet, columns, dropdowns, checkboxes, or formatting.
- Optionally checks IMAP replies before sending follow-ups.
- Sends first emails and follow-ups through Resend.
- Updates only existing cells in the current sheet.
- Supports `dry-run` mode that sends nothing and writes nothing.

## Files

- `package.json`
- `tsconfig.json`
- `.env.example`
- `src/index.ts`
- `src/googleSheets.ts`
- `src/templates.ts`
- `src/resendClient.ts`
- `src/imapReplies.ts`
- `src/outreach.ts`
- `src/types.ts`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your values.

3. Create a Google Cloud project for the sheet access.

## Google Sheets service account setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the Google Sheets API for that project.
4. Go to `APIs & Services` -> `Credentials`.
5. Create a `Service account`.
6. Create a JSON key for that service account.
7. Download the JSON key file.
8. Put that JSON file at the repo root as `google-service-account.json`.
   This file is already ignored by git.
9. Open your existing Google Sheet.
10. Share the sheet with the service account email from the JSON file's `client_email`.
    The service account needs edit access so the tool can update existing cells.

Preferred local setup:

```env
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./google-service-account.json
```

Optional fallback:

If you do not want to keep the JSON file in the repo root, you can still copy the service account email into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and the private key into `GOOGLE_PRIVATE_KEY`.
Put the private key on one line in `.env` and keep the escaped newlines, for example:

```env
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n
```

## Required environment variables

```env
GOOGLE_SHEET_ID=
GOOGLE_SHEET_NAME=
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./google-service-account.json
RESEND_API_KEY=
OUTREACH_FROM_EMAIL=hello@turboreplies.com
OUTREACH_FROM_NAME=Federico | TurboReplies
OUTREACH_REPLY_TO=hello@turboreplies.com
MAX_EMAILS_PER_RUN=5
CHECK_REPLIES=false
ALLOW_SEND_IF_IMAP_FAILS=false
IMAP_HOST=mail.privateemail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=hello@turboreplies.com
IMAP_PASS=
```

Fallback auth variables if you are not using the JSON file:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

`IMAP_*` values are required only when `CHECK_REPLIES=true`.

## Commands

Dry run:

```bash
npm run dry-run
```

This prints each eligible email preview and the row changes that would happen. It does not send emails and does not update the sheet.

Send:

```bash
npm run send
```

This sends through Resend and updates the sheet only after each successful send. If a send fails, that row is not marked as sent.

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
- Follow-up 2:
  - `Status = Active`
  - `Follow-up Step = 2`
  - `Next Follow-up` is today or earlier
- Follow-up 3:
  - `Status = Active`
  - `Follow-up Step = 3`
  - `Next Follow-up` is today or earlier
- Never send:
  - when `Email` is empty
  - when `Replied? = TRUE`
  - when `Do Not Contact? = TRUE`
  - when `Status` is `Needs reply`, `Interested`, `Not interested`, or `Bad fit`
- Sending limit:
  - capped by `MAX_EMAILS_PER_RUN`

## IMAP reply detection

When `CHECK_REPLIES=true`, the tool connects to IMAP before sending anything.

For rows where:

- `Status = Active`
- `Replied?` is not `TRUE`

it searches the inbox for messages from the row email address and only counts messages dated after `Date sent`.
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
