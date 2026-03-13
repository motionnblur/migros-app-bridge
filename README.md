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
| `DB_USER` | No | `postgres` | PostgreSQL user |
| `DB_PASSWORD` | No | `postgres` | PostgreSQL password |
| `JWT_SECRET` | Yes | - | Secret for signing/verifying JWT |
| `JWT_EXPIRES_IN` | No | `1h` | JWT expiration |
| `SPRING_SUPPORT_BASE_URL` | No | `http://localhost:8080` | Core backend base URL |
| `SPRING_SUPPORT_INTERNAL_KEY` | No | empty | Sent as `x-internal-key` to Spring |
| `INTERNAL_EVENT_KEY` | No | empty | Required `x-internal-key` for `/internal/events/*` |

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
DB_PASSWORD=postgres
JWT_SECRET=change-me
JWT_EXPIRES_IN=1h
SPRING_SUPPORT_BASE_URL=http://localhost:8080
SPRING_SUPPORT_INTERNAL_KEY=
INTERNAL_EVENT_KEY=
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

## Authentication

- `POST /auth/login` returns `accessToken` (Bearer JWT).
- Pass token in `Authorization: Bearer <token>`.
- `/support/*` and `/auth/me` require authentication.

## API endpoints

### Health

- `GET /` - API health message
- `GET /health/db` - PostgreSQL connectivity health

### Auth

- `POST /auth/login`
  - body: `{ "username": "...", "password": "..." }`
- `GET /auth/me` (Bearer token required)

### Users

- `GET /users`
- `GET /users/:id`

### Support (Bearer token required)

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
If `INTERNAL_EVENT_KEY` is set, requests must include header:

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
