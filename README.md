# migros-support-backend

Backend API for the Migros support workspace.  
It handles support authentication, conversation/message state in PostgreSQL, and synchronization with the core Spring backend.

## What this service does

- Exposes REST APIs for support agents (`/support/*`).
- Stores support conversations and messages in PostgreSQL.
- Ingests internal events from the core backend (`/internal/events/*`) with idempotency.
- Forwards support actions (send/edit/delete/ban/unban/clear) to the Spring backend.
- Provides health checks and simple user/auth endpoints.

## Tech stack

- Node.js + Express 5
- PostgreSQL (`pg`)
- JWT (`jsonwebtoken`)
- Password hash verify (`bcryptjs`)
- Environment config (`dotenv`)

## Architecture (high level)

1. `server.js` starts the app and initializes support tables/indexes.
2. Express routes are mounted in `src/routes/index.js`.
3. Support data is persisted in PostgreSQL:
   - `support_conversations`
   - `support_messages`
   - `support_ingested_events`
4. Mutating support operations are mirrored to the Spring backend through internal HTTP calls.
5. Internal event endpoints keep local support data in sync with upstream events.

## Project structure

```text
.
|- server.js
|- src/
|  |- app.js
|  |- config/
|  |  |- env.js
|  |  `- db.js
|  |- controllers/
|  |  |- authController.js
|  |  |- healthController.js
|  |  |- supportController.js
|  |  `- userController.js
|  |- middlewares/
|  |  `- authMiddleware.js
|  |- routes/
|  |  |- index.js
|  |  |- authRoutes.js
|  |  |- healthRoutes.js
|  |  |- supportRoutes.js
|  |  |- internalEventsRoutes.js
|  |  `- userRoutes.js
|  `- services/
|     `- authService.js
`- package.json
```

## Requirements

- Node.js 18+ (uses global `fetch`)
- PostgreSQL

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port |
| `DB_HOST` | No | `localhost` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | No | `migros_support_db` | PostgreSQL database name |
| `DB_USER` | Yes* | - | PostgreSQL user |
| `DB_PASSWORD` | Yes* | - | PostgreSQL password |
| `JWT_SECRET` | Yes | - | Secret for signing/verifying JWT |
| `JWT_EXPIRES_IN` | No | `1h` | JWT expiration |
| `SPRING_SUPPORT_BASE_URL` | No | `http://localhost:8080` | Core backend base URL |
| `SPRING_SUPPORT_INTERNAL_KEY` | No | empty | Sent as `x-internal-key` to Spring |
| `INTERNAL_EVENT_KEY` | Yes** | - | Required `x-internal-key` for `/internal/events/*` |
| `SUPPORT_ALLOWED_ROLES` | No | `support_agent,support_admin,admin` | Allowed JWT `role` values for `/support/*` and `/users/*` |
| `SUPPORT_ALLOWED_USERNAMES` | No | empty | Comma-separated username allowlist for `/support/*` and `/users/*` |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | No | `900000` | Login rate limit window duration |
| `LOGIN_RATE_LIMIT_LOCKOUT_MS` | No | `900000` | Login lockout duration after threshold |
| `LOGIN_RATE_LIMIT_MAX_PER_IP` | No | `100` | Max failed login attempts per IP per window |
| `LOGIN_RATE_LIMIT_MAX_PER_USERNAME_IP` | No | `10` | Max failed login attempts per username+IP per window |
| `SPRING_REQUEST_TIMEOUT_MS` | No | `5000` | Timeout for internal Spring HTTP requests |
| `SUPPORT_STATUS_CONCURRENCY` | No | `10` | Max concurrent upstream requests in conversation status fan-out |
| `JSON_BODY_LIMIT` | No | `100kb` | Maximum JSON request body size |
| `ALLOW_INSECURE_INTERNAL_EVENTS` | No | `false` | Dev-only bypass for missing `INTERNAL_EVENT_KEY` |
| `ALLOW_INSECURE_SUPPORT_ACCESS` | No | `false` | Dev-only bypass for role/username support authorization |
| `ALLOW_INSECURE_DB_DEFAULTS` | No | `false` | Dev-only fallback to `postgres/postgres` if DB creds are missing |

\* `DB_USER` and `DB_PASSWORD` are required unless `ALLOW_INSECURE_DB_DEFAULTS=true` in non-production.  
\** `INTERNAL_EVENT_KEY` is required unless `ALLOW_INSECURE_INTERNAL_EVENTS=true` in non-production.

## Setup

```bash
npm install
```

Create a `.env` file (example):

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=migros_support_db
DB_USER=postgres
DB_PASSWORD=change-me
JWT_SECRET=change-me
JWT_EXPIRES_IN=1h
SPRING_SUPPORT_BASE_URL=http://localhost:8080
SPRING_SUPPORT_INTERNAL_KEY=
INTERNAL_EVENT_KEY=change-me
SUPPORT_ALLOWED_ROLES=support_agent,support_admin,admin
SUPPORT_ALLOWED_USERNAMES=
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_LOCKOUT_MS=900000
LOGIN_RATE_LIMIT_MAX_PER_IP=100
LOGIN_RATE_LIMIT_MAX_PER_USERNAME_IP=10
SPRING_REQUEST_TIMEOUT_MS=5000
SUPPORT_STATUS_CONCURRENCY=10
JSON_BODY_LIMIT=100kb
ALLOW_INSECURE_INTERNAL_EVENTS=false
ALLOW_INSECURE_SUPPORT_ACCESS=false
ALLOW_INSECURE_DB_DEFAULTS=false
```

Start:

```bash
npm run dev
```

or

```bash
npm start
```

## Database notes

On startup, this service auto-creates and migrates:

- `support_conversations`
- `support_messages`
- `support_ingested_events`
- related indexes

It **does not** create the `users` table used by auth endpoints.  
You need a compatible `users` table with at least:

- `id`
- `username`
- `password_hash` (bcrypt hash)
- `created_at`

Optional but recommended for role-based authorization:

- `role` (e.g. `support_agent`, `support_admin`, `admin`)

## Authentication

- `POST /auth/login` returns `accessToken` (Bearer JWT).
- Pass token in `Authorization: Bearer <token>`.
- `/support/*` and `/users/*` require authentication plus support authorization.
- Support authorization is granted by either:
  - JWT `role` claim matching `SUPPORT_ALLOWED_ROLES`, or
  - username listed in `SUPPORT_ALLOWED_USERNAMES`.

## API endpoints

### Health

- `GET /` - API health message
- `GET /health/db` - PostgreSQL connectivity health

### Auth

- `POST /auth/login`
  - body: `{ "username": "...", "password": "..." }`
- `GET /auth/me` (Bearer token required)

### Users

- `GET /users` (Bearer token + support access required)
- `GET /users/:id` (Bearer token + support access required)

### Support (Bearer token + support access required)

- `GET /support/customers?query=<text>&limit=<1-100>`
- `GET /support/conversations?limit=<1-200>`
- `GET /support/conversations/status?conversationIds=id1,id2,...` (max 200 ids)
- `GET /support/conversations/:conversationId/messages?limit=<1-500>`
- `POST /support/conversations/:conversationId/messages`
  - body: `{ "text": "..." }`
- `PATCH /support/conversations/:conversationId/messages/:messageId`
  - body: `{ "text": "..." }`
- `DELETE /support/conversations/:conversationId/messages/:messageId`
- `POST /support/conversations/:conversationId/ban`
- `POST /support/conversations/:conversationId/unban`
- `POST /support/conversations/:conversationId/clear`

### Internal event ingestion

Base path: `/internal/events`  
Requests must include header:

```http
x-internal-key: <INTERNAL_EVENT_KEY>
```

Endpoints:

- `POST /internal/events/customer-message-created`
  - required payload fields:
    - `messageId`
    - `text`
    - `conversationId` and `customerId` (or fallback `userMail`)
  - optional:
    - `eventId` (enables idempotency)
    - `occurredAt`
- `POST /internal/events/support-message-edited`
  - required: `userMail`, `messageId`, `text`
  - optional: `eventId`
- `POST /internal/events/support-message-deleted`
  - required: `userMail`, `messageId`
  - optional: `eventId`

## Error behavior

- Validation errors: `400`
- Unauthorized token/key: `401`
- Not found: `404`
- Business rule conflicts (e.g., non-editable message): `409`
- Upstream Spring forwarding failures: `502`
- Unexpected errors: `500`

## Scripts

- `npm start` - run server
- `npm run dev` - run with Node watch mode
- `npm test` - placeholder (currently not implemented)
