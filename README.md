# Adobe Analytics Bulk Data Insertion Web Application

A responsive, framework-free web application for inspecting, compressing, validating, and
uploading CSV files to the Adobe Analytics Bulk Data Insertion API (BDIA).

## Features

- Keeps the OAuth access token and client ID in browser memory only.
- Generates an IMS access token from Server-to-Server credentials, or accepts a token
  you already have.
- Uses the client secret once for the token request, then clears it from the page.
- Parses the selected CSV locally and verifies every data row has the configured
  `reportSuiteID` value, with an on-demand `Verify CSV` re-check.
- Compresses the original file into gzip format with the browser `CompressionStream` API.
- Generates a stable `bdia-<sha256>` idempotency key from the exact original file bytes.
- Validates the gzip file with Adobe before enabling upload.
- Looks up the idempotency key before upload and skips files Adobe already received.
- Uploads with `x-adobe-idempotency-key`.
- Polls Adobe's idempotency lookup after upload and supports manual status checks.
- Displays HTTP status, response headers, raw JSON or text, and timestamps.
- Routes every Adobe call through a Node.js/Express proxy, avoiding browser CORS limits.
- Shows the full Adobe upload receipt, including dropped `invalid_rows`.

## Adobe API behavior

The Adobe endpoints are defined once in `js/adobe-api.js`:

| Operation | Method | Endpoint |
|---|---|---|
| Validate | `POST` | `/aa/collect/v1/events/validate` |
| Upload | `POST` | `/aa/collect/v1/events` |
| Idempotency lookup | `GET` | `/aa/collect/v1/events/key/{idempotency_key}` |

The default API base URL is:

```text
https://analytics-collection.adobe.io
```

Confirm endpoint behavior against the current
[Adobe Bulk Data Insertion API documentation](https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/bulk-data-insertion/endpoints)
before production deployment.

### Request headers

The frontend and proxy send:

```text
Authorization: Bearer <OAUTH_ACCESS_TOKEN>
x-api-key: <CLIENT_ID>
```

Uploads and validation additionally send:

```text
x-adobe-vgid: <VISITOR_GROUP_ID>
```

Uploads additionally send:

```text
x-adobe-idempotency-key: bdia-<SHA256>
```

Adobe **requires** `x-adobe-vgid` on the upload endpoint and returns
`HTTP 400 {"error":"Request is missing required header 'x-adobe-vgid'"}` without it. The
validate endpoint accepts requests without it, so a missing visitor group ID shows up only
at upload time. Set it in the Configuration card.

The client secret is not needed and is never requested. The report suite is not sent as an HTTP
header. Adobe reads it from each CSV row's `reportSuiteID` column.

### Equivalent cURL requests

The app uses browser `fetch` to send the compressed file to the backend proxy, which
forwards it to Adobe. The following commands reproduce those requests; the app does not
execute cURL itself. Replace the placeholders with your access token, client ID, visitor
group ID, gzip file path, and the app's generated `bdia-<SHA256>` idempotency key.
Do not save real credentials in this document or commit them to source control.

**Upload directly to Adobe** (the request forwarded by the proxy):

```bash
curl --request POST \
  'https://analytics-collection.adobe.io/aa/collect/v1/events' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <ACCESS_TOKEN>' \
  --header 'x-api-key: <CLIENT_ID>' \
  --header 'x-adobe-vgid: <VISITOR_GROUP_ID>' \
  --header 'x-adobe-idempotency-key: bdia-<SHA256>' \
  --form 'file=@/absolute/path/ingest_file.csv.gz;type=application/gzip'
```

**Upload through the local backend** (the request made by the browser):

```bash
curl --request POST \
  'http://localhost:3000/api/adobe/upload' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <ACCESS_TOKEN>' \
  --header 'x-api-key: <CLIENT_ID>' \
  --header 'x-adobe-vgid: <VISITOR_GROUP_ID>' \
  --header 'x-adobe-idempotency-key: bdia-<SHA256>' \
  --form 'file=@/absolute/path/ingest_file.csv.gz;type=application/gzip'
```

Use your configured Backend Proxy URL instead of `http://localhost:3000` when applicable.
If `ADOBE_API_BASE_URL` is overridden in the backend, use that base URL in the direct command.
The file must already be gzip-compressed. Do not set `Content-Type: application/json` or
manually set the multipart boundary: `--form` makes cURL generate the multipart content type
and boundary automatically. Do not send the client secret, organization ID, or report suite
ID as upload headers.

To reproduce the app's **validation** request, use the same file and headers but change
the direct URL to `/aa/collect/v1/events/validate` (or the proxy URL to
`/api/adobe/validate`) and omit `x-adobe-idempotency-key`.

The app also performs an **idempotency lookup before upload** and polls it afterward:

```bash
curl --request GET \
  'https://analytics-collection.adobe.io/aa/collect/v1/events/key/bdia-<SHA256>' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <ACCESS_TOKEN>' \
  --header 'x-api-key: <CLIENT_ID>'
```

For the proxy equivalent, use
`http://localhost:3000/api/adobe/status/bdia-<SHA256>`.
Keep the same key for the same original CSV bytes. These commands bypass the UI's CSV
verification, validation gate, and duplicate-check workflow; perform those checks before
uploading. cURL displays Adobe's raw response, without the UI's `UPLOADED` fallback.

## Requirements

- A current desktop or tablet browser supporting:
  - ES modules
  - Web Crypto `crypto.subtle`
  - `CompressionStream("gzip")`
- A short-lived Adobe OAuth access token.
- The Adobe Developer Console client ID associated with that token.
- A correctly formatted CSV file.
- Node.js 18 or newer only if using the optional proxy.

## Run the frontend

Browsers block some features when an application is opened directly with `file://`. Serve the
folder over HTTP instead.

From `bulk_insertion_api/`:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Enter the access token and client ID, select a CSV, and follow the enabled buttons.

## Connection

```text
Browser -> Local/managed proxy -> Adobe IMS / Adobe Analytics API
```

The backend proxy is the only connection path. Direct browser-to-Adobe calls are not offered
because Adobe IMS does not return CORS headers for browser origins, so in-browser token
generation always fails with an opaque network error.

The proxy forwards only the OAuth access token, client ID, visitor group ID, gzip file, and
idempotency key needed by Adobe. It accepts the client secret solely for the token exchange
and never stores or logs credentials.

Install and run it:

```bash
cd backend
cp .env.example .env
npm install
npm start
```

The proxy also serves the frontend at:

```text
http://localhost:3000
```

In the application:

1. Set **Backend Proxy URL** to `http://localhost:3000`.
2. Generate an access token, or paste an existing one.
3. Enter the client ID and confirm the Visitor Group ID.

If the frontend is served separately from `http://localhost:8080`, the default
`ALLOWED_ORIGIN` setting already permits it. For another deployment origin, update
`backend/.env`:

```env
PORT=3000
ADOBE_API_BASE_URL=https://analytics-collection.adobe.io
ALLOWED_ORIGIN=https://your-frontend.example
MAX_UPLOAD_MB=100
```

Use HTTPS for both the frontend and proxy in production. Sending bearer tokens over plain HTTP
is appropriate only for local loopback development.

## Workflow

### 0. Authentication

The Authentication card offers two methods:

**Generate access token** (default) — Enter the client ID, client secret, and scopes, then
select `Generate Access Token`. The application posts a `client_credentials` grant to the
Adobe IMS token endpoint (`https://ims-na1.adobelogin.com/ims/token/v3` by default) and keeps
the resulting token in memory. The status line shows a live expiry countdown, and requests
are blocked once the token expires.

The Organization ID field is reference information only; IMS does not use it in the
`client_credentials` request, and BDIA does not send it as a header.

Adobe IMS does not send CORS headers for browser origins, so all token requests are routed
through the backend proxy.

**Use existing token** — Paste a token you generated elsewhere. No secret is required.

### 1. Inspect CSV

The application parses the CSV in the browser. Quoted commas, escaped quotes, and quoted
multiline values are supported. It rejects:

- A file without a `.csv` extension.
- A file without a header and at least one data row.
- An unterminated quoted value.
- Rows whose column counts differ from the header.

### 1b. Verify the report suite

After the CSV is parsed, the Configuration card shows a verification panel with whether the
`reportSuiteID` column is present, which report suites the file actually contains, and how
many rows target the configured suite. Validation and upload stay disabled until every data
row matches.

The default expected report suite is `cdwglobaldev`. Change the Configuration field and
select `Verify CSV` to re-check the already-selected file without reloading it.

The Configuration card also holds the **Visitor Group ID**, sent as `x-adobe-vgid`. Adobe uses
it to group visitors across uploads and rejects uploads that omit it.

### 2. Compress

The file is streamed through the browser's native gzip compressor. The original CSV is not
modified. The interface shows original and compressed sizes.

### 3. Generate idempotency key

The browser calculates SHA-256 over the exact original CSV bytes:

```text
bdia-<64-character SHA-256 hex digest>
```

Selecting the same exact file always produces the same key. Any byte-level change, including
line endings or whitespace, produces a different key.

### 4. Validate

The compressed file is sent as multipart form data to Adobe's validation endpoint. Upload
remains disabled unless the response is successful and contains a case-insensitive
`File is valid` success value.

### 5. Duplicate check and upload

Before upload, the application calls the idempotency lookup endpoint with the stable key:

- If Adobe returns a file record, the upload is skipped.
- If Adobe reports `File not found`, the gzip file is uploaded with the same key.
- If lookup fails unexpectedly, upload stops rather than risking duplicate ingestion.

After a successful upload, the **upload receipt** panel in the Submit card shows the fields
Adobe returns:

| Field | Shown as |
| --- | --- |
| `file_id` | File ID |
| `status_code` | Status code (also the badge) |
| `status` | Upload status |
| `upload_name` | Upload name |
| `visitor_group_id` | Visitor group |
| `rows` | Rows accepted |
| `invalid_rows` | Invalid rows |
| `size` | Size received |
| `received_date` | Received date (converted from epoch seconds) |
| `processing_log` | Log text below the grid |
| `idempotency_key` | Idempotency key |

Successful uploads always show `status_code: "UPLOADED"` in the receipt and the Adobe
Response panel. If Adobe omits that field, the application derives it from the successful
upload response and displays the idempotency key used for the request. Automatic ingestion
polling leaves that upload response visible; a manual **Check Status** replaces it with the
latest status response.

Adobe returns **HTTP 200 even when `invalid_rows` is greater than zero**, so a successful
upload can still silently drop rows. When that happens the badge turns amber, the invalid
count is highlighted, and the status message reports how many rows were dropped.

### 6. Check status

After a successful upload response, the application checks the lookup endpoint every five
seconds, for up to twelve attempts. These values are configurable in `js/adobe-api.js`:

```js
STATUS_POLL_INTERVAL: 5000,
MAX_STATUS_ATTEMPTS: 12,
```

Polling stops when Adobe returns a response containing `file_id`, when an unexpected lookup
error occurs, or when the maximum number of attempts is reached. **Check Status** remains
available for a later manual lookup.

## API service configuration

All browser-side Adobe behavior is isolated in `js/adobe-api.js`. Update `CONFIG.API_BASE_URL`
there if Adobe requires a confirmed regional endpoint:

```js
export const CONFIG = Object.freeze({
  API_BASE_URL: "https://analytics-collection.adobe.io",
  VALIDATE_ENDPOINT: "/aa/collect/v1/events/validate",
  UPLOAD_ENDPOINT: "/aa/collect/v1/events",
  STATUS_ENDPOINT: "/aa/collect/v1/events/key",
  STATUS_POLL_INTERVAL: 5000,
  MAX_STATUS_ATTEMPTS: 12,
});
```

The Express proxy holds the effective `ADOBE_API_BASE_URL` environment setting, since every
Adobe call is routed through it.

## Security considerations

- Access tokens and client IDs remain in memory and are cleared when the page closes or reloads.
- The client secret is used for exactly one IMS token request and is removed from the input
  field as soon as a token is issued. It is never stored, echoed, or sent to any BDIA endpoint.
- Generated token values are redacted (`<redacted>`) in the Adobe Response viewer.
- The proxy's `POST /api/adobe/token` route accepts token endpoints only over HTTPS on
  `adobelogin.com` hosts, and returns only `access_token`, `token_type`, and `expires_in`.
- `Clear Credentials` erases the client ID, secret, generated token, and pasted token.
- Reset intentionally clears file and response state but leaves credentials until the user
  explicitly edits or clears them.
- Tokens are password-masked by default.
- Tokens and client secrets are never logged by application code.
- Credentials are never put in URLs.
- No application credentials are committed to source.
- The optional proxy holds uploaded files in bounded memory only and does not write them to disk.
- Response headers are displayed for troubleshooting; Adobe response bodies are preserved rather
  than replaced with guessed fields.
- Treat the browser and proxy host as sensitive systems because bearer tokens pass through them.

## Troubleshooting

### A request fails with a network error

The proxy is not reachable. Start it with `npm start` in `backend/`, confirm it responds at
`GET /api/health`, and check the **Backend Proxy URL** field.

### Token request returns `invalid client_id parameter` or `invalid_client`

The client ID or client secret does not match an Adobe Developer Console OAuth
Server-to-Server credential. Re-copy both values from the project's credential page.

### HTTP 401

The OAuth token is missing, invalid, or expired, or the client ID does not match it. Generate a
new short-lived token and verify the client ID.

### HTTP 403

The Adobe integration or user does not have permission for the operation or report suite.
Review Adobe Developer Console and Analytics permissions.

### HTTP 429

Adobe rate limiting is active. Wait before retrying. Do not repeatedly click upload; the
application disables workflow buttons while requests are running.

### Report Suite validation failed

Ensure the CSV contains a case-sensitive `reportSuiteID` header and that every data row contains
the configured value, which defaults to `cdwglobaldev`.

### Adobe rejects validation

Review the original Adobe response in the response viewer. Fix the CSV before retrying. The
application will not enable upload for a rejected validation response.

### Validation succeeds but upload returns HTTP 400

If the error is `Request is missing required header 'x-adobe-vgid'`, the Visitor Group ID in
the Configuration card is empty. The validate endpoint ignores this header, so the problem
appears only at upload. Enter a value and retry.

### Duplicate upload skipped

Adobe returned a file for the same content-derived idempotency key. The application deliberately
does not upload the file again. The existing `file_id`, row count, and other fields returned by
Adobe are shown unchanged.

### Proxy rejects a large file

Raise `MAX_UPLOAD_MB` in `backend/.env` only after considering server memory limits. Each upload
is held in memory while it is forwarded.

## Project structure

```text
bulk_insertion_api/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── adobe-api.js
│   ├── auth.js
│   ├── compressor.js
│   ├── csv.js
│   ├── hash.js
│   └── ui.js
├── assets/
├── backend/
│   ├── server.js
│   ├── package.json
│   └── .env.example
├── README.md
└── .gitignore
```
