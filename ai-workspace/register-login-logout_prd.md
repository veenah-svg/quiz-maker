Date created: 2026-09-02
Date last modified: 2026-09-03

# Register, Login, and Logout - Technical PRD

## Overview/Problem

Quiz Maker is a greenfield application whose long-term purpose is a shared test bank of multiple-choice questions that several teachers can build together. This feature is **shipped**: teachers can register, log in, log out, and land on a placeholder MCQ page. Accounts live in Cloudflare D1. Passwords are SHA-256 hashed in the browser before POST. Each browser gets its own D1 `sessions` row and an HttpOnly `qm_session` cookie. `/mcqs` requires a valid session for **that** browser. Logout deletes only that session, so another browser stays signed in. A new or private window has no cookie and must enter username and password again.

Do **not** re-implement register/login/logout. Treat this PRD as the as-built contract. The next sprint should write a new PRD for MCQ CRUD and extend `/mcqs`.

### Shipped architecture (read this first)

```
Browser (client components)          Server (route handlers)           D1
---------------------------          -----------------------           --
SignupForm / LoginForm
  hashPassword(plaintext)  ──POST──► /api/register | /api/login
  credentials: include               Zod body in auth-schemas.ts
                                     createUser / getUserByUsername ──► users
                                     createSession ──────────────────► sessions
                                     Set-Cookie: qm_session (HttpOnly, this browser only)
LogoutButton ──────────────POST────► /api/logout
                                     deleteSession(cookie id only)
                                     expire qm_session cookie
/mcqs layout                         getSession(cookie) or redirect /login
```

- Login is by **username**, not email.
- The server stores and compares the client hash; it does **not** hash again.
- HTTP JSON never includes `passwordHash` on success.
- `updateUser` / `deleteUser` exist on the service but have no HTTP/UI yet.
- Two browsers = two session rows. Logout in one does not delete the other.

---

## Hypothesis

We believe that a simple register, login, and logout flow backed by a hashed-password user table will let multiple teachers establish distinct accounts and reach a shared application shell, which is the prerequisite for later collaborative question-bank work.

---

## Scope

### In Scope

- Cloudflare D1 database binding `DB` for database `quizmaker`
- A `users` table and Wrangler D1 migration `migrations/0001_create_users.sql`
- User fields: primary key, first name, last name, username, email, and a hashed password
- Username and email stored as separate unique columns; a given user may set them to the same value (for example both `teacher@school.edu`)
- Client-side hashing of the password the teacher types, with the hash sent in the HTTP POST body for register and login (plaintext passwords are not sent over the wire)
- Server stores the received hash in D1 and compares hashes on login (no second transformation unless documented below)
- A user service in `src/lib/services/` with create, update, delete, and the lookups register/login need
- HTTP POST endpoints for register, login, and logout; register and login call the user service
- Per-browser D1 sessions (`sessions` table + HttpOnly `qm_session` cookie). Logout deletes only that session id
- `/mcqs` requires a valid session for the requesting browser
- Register and login pages, plus a logout action
- After successful register or login, navigate to a stub MCQ page
- The MCQ page is a placeholder only (title and short copy). No question CRUD
- Vitest unit tests, written first in every phase (red), then implementation until they pass (green)

### Out of Scope

- Creating, editing, listing, or sharing multiple-choice questions
- Teacher collaboration features beyond being able to have more than one user account
- Email verification, password reset, or “forgot password”
- Account profile editing UI (the service may update a user; no settings page in this feature)
- Rate limiting, CAPTCHA, or lockout after failed logins
- Authorization / roles (every registered user is just a user)
- HTTPS-related infrastructure beyond what Cloudflare already provides in preview/deploy

### Cut

- Social logins (Google, Microsoft, etc.) — extra providers and OAuth flows are not needed to prove multi-teacher accounts
- Tokens (JWT, API keys, bearer auth) — not used; login state is a D1 session id in an HttpOnly cookie
- Slow salted password hashing (bcrypt / Argon2 / PBKDF2) — this phase uses SHA-256 via Web Crypto so the client can hash before POST without a new native dependency on Workers; a later sprint can replace this with a salted server-side KDF
- Signing out **every** browser at once — logout must delete only the session id in this browser’s cookie
- `@cloudflare/vitest-pool-workers` and tests that hit a real D1/Workers runtime — unit tests mock D1 and `getCloudflareContext()`. Raise with the user before changing how the suite runs

---

## Technical Requirements

### Database Schema

Add a D1 database named `quizmaker` (or the name Wrangler returns) with binding `DB` in `wrangler.jsonc`. Then run `npm run cf-typegen`. Do not apply migrations remotely.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_email ON users (email);
```

**Column notes:**

| Column | Rules |
|--------|--------|
| `id` | Opaque TEXT primary key; do not use autoincrement integers |
| `first_name`, `last_name` | Required, trimmed, non-empty |
| `username` | Required, unique across users. May equal that user’s `email`. |
| `email` | Required, unique across users, stored lowercased |
| `password_hash` | SHA-256 hex digest of the password the user typed. Never store plaintext. Never log this column. |
| `created_at` / `updated_at` | Set on insert; `updated_at` refreshed on update |

Username uniqueness and email uniqueness are independent. Two different users cannot share a username or an email. One user may use the same string for both.

Each login or register also inserts a `sessions` row (`migrations/0002_create_sessions.sql`): `id` (unguessable TEXT), `user_id`, `expires_at` (ISO timestamp, 7 days), `created_at`. Logout deletes by `id` only so two browsers can stay independent.

### Password hashing

Hashing happens in the browser before the POST. Use the Web Crypto API (`crypto.subtle.digest`) with SHA-256 and hex-encode the 32-byte digest. The same helper lives in `src/lib/password.ts` and is importable from client components (no D1, no `getCloudflareContext`).

```typescript
export async function hashPassword(plaintext: string): Promise<string> {
	const data = new TextEncoder().encode(plaintext.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function passwordHashesMatch(stored: string, received: string): boolean {
	if (stored.length !== received.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < stored.length; i += 1) {
		mismatch |= stored.charCodeAt(i) ^ received.charCodeAt(i);
	}
	return mismatch === 0;
}
```

- Register: hash locally → POST `{ …profile fields, passwordHash }` → service inserts `password_hash`
- Login: hash locally → POST `{ username, passwordHash }` → service loads the user and compares with a length-constant equality check
- Do not send or persist the plaintext password
- Do not hash again on the server in this phase (the stored value is the client hash)

This is a deliberate simplification. SHA-256 is fast and unsalted; stolen rows are rainbow-tableable, and a captured hash is replayable as the login secret. HTTPS still matters. Treat this as a known limitation, not accidental.

### API Endpoints

Use App Router route handlers under `src/app/api/`. These are HTTP endpoints, not Server Actions, because the client must hash and then POST JSON. Validate every body with Zod before calling the service. Never import D1 into a `'use client'` module.

Generic error shape:

```json
{ "error": "Human-readable message" }
```

Do not reveal whether a username or email already exists on login failure. On register, duplicate username or email may be reported as a conflict so the teacher can pick another value.

#### POST /api/register

**Request Body:**

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "username": "alovelace",
  "email": "ada@school.edu",
  "passwordHash": "hex-encoded-sha256"
}
```

`username` may equal `email`. `passwordHash` is the SHA-256 hex string (64 characters).

**Response:**

- Success (201): `{ "id", "firstName", "lastName", "username", "email" }` — never return `passwordHash`
- Error (400): validation failure (missing fields, invalid email, passwordHash not 64 hex chars, empty names)
- Error (409): username or email already taken
- Error (500): unexpected server error

On 201, the client navigates to `/mcqs`.

#### POST /api/login

**Request Body:**

```json
{
  "username": "alovelace",
  "passwordHash": "hex-encoded-sha256"
}
```

Login is by `username` (not email), plus the client-computed hash. If a teacher set username equal to email, they type that same string in the username field.

**Response:**

- Success (200): `{ "id", "firstName", "lastName", "username", "email" }` — never return `passwordHash`
- Error (400): validation failure
- Error (401): no such user or hash mismatch. Message: `"Invalid username or password"`
- Error (500): unexpected server error

On 200, the client navigates to `/mcqs`.

#### POST /api/logout

**Request Body:** none (empty JSON object is acceptable). Send this browser’s `qm_session` cookie (`credentials: "include"`).

**Response:**

- Success (200): `{ "ok": true }` plus `Set-Cookie` that expires `qm_session` on **this** browser

Logout looks up the cookie, deletes **that** `sessions` row (`DELETE FROM sessions WHERE id = ?1`), and clears the cookie. It must not delete other rows for the same `user_id`. After 200, the client navigates to `/login`. Visiting `/mcqs` in this browser then redirects to `/login`. Another browser that still has its own cookie stays on `/mcqs` until it logs out.

No other user HTTP routes are required this feature (no GET current user, no PATCH profile, no DELETE account endpoint). Update and delete live on the service for later features.

### User Interface Requirements

Use existing shadcn/ui pieces (`button`, `card`, `field`, `input`, `label`). Visual layout comes from the **shadcn login and signup blocks** (centered `min-h-svh` page + Card form). Adapt the stock blocks to this feature; do not paste them unchanged. Forms are client components so they can hash with Web Crypto, then `fetch` the API. Surface API and validation errors with `FieldError`. Do not add `react-hook-form`. Tailwind is already how shadcn is styled; do not add another CSS approach.

**Stock block → Quiz Maker mapping:**

| Stock shadcn block | This app |
|---|---|
| `LoginForm` email field | **Username** (login is by username, not email). Helper text: if they registered with the same value for both, that value is their username |
| `SignupForm` single “Full Name” | Separate **first name** and **last name**, plus **username** |
| Forgot password link | **Removed** (password reset is out of scope) |
| Login/Sign up with Google | **Removed** (social login is cut) |
| `href="#"` account links | Real routes: `/register` and `/login` |
| Paths `@/components/login-form` and `@/components/signup-form` | Keep those filenames. `/register` renders `SignupForm` |

Page shells keep the block layout:

```tsx
<div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
  <div className="w-full max-w-sm">
    {/* LoginForm or SignupForm */}
  </div>
</div>
```

#### Home (`/`)

- Replace the Next.js starter page with a short Quiz Maker landing
- Primary actions: links to `/register` and `/login`
- No authentication check

#### Register (`/register`) — `SignupForm`

- Fields: first name, last name, username, email, password, confirm password
- Username and email may be identical; do not treat that as an error
- Client validation before POST:
  - All fields required
  - Email looks like an email
  - Password minimum 8 characters
  - Password and confirm password match
- On submit: hash the password, POST `/api/register` with `passwordHash` only (not plaintext, not confirm password)
- On 201: go to `/mcqs`
- On 409/400/500: show the error on the form via `FieldError`; stay on `/register`
- Link to `/login` for teachers who already have an account (“Already have an account? Sign in”)

#### Login (`/login`) — `LoginForm`

- Fields: username, password
- On submit: hash the password, POST `/api/login`
- On 200: go to `/mcqs`
- On 401/400/500: show a generic or server message via `FieldError`; stay on `/login`
- Link to `/register` (“Don't have an account? Sign up”)

#### MCQ stub (`/mcqs`)

- Placeholder page only: heading such as “Question bank” and copy that this is where teachers will manage multiple-choice questions next
- `src/app/mcqs/layout.tsx` requires a valid `qm_session` (cookie + D1 row). Missing or expired session → `redirect("/login")`
- A Logout control that POST `/api/logout` (with credentials) then navigates to `/login`
- No question forms, lists, or APIs

#### Logout

- Triggered from `/mcqs` (and any future authenticated chrome)
- POST `/api/logout` with `credentials: "include"`, then navigate to `/login`
- Clears this browser only; other browsers keep their cookies and session rows

---

## Test-Driven Development

Every implementation phase is **red → green → (then) done**. Tests are the first work product of the phase, not a cleanup step. A phase is not complete because files exist; it is complete when that phase’s Vitest suite is green **and** the phase’s acceptance checks pass.

### Framework

Use **Vitest**. It is installed. Config is `vitest.config.ts`; matchers load from `vitest.setup.ts` (`@testing-library/jest-dom/vitest`). Scripts: `npm test` (`vitest run`) and `npm test:watch` (`vitest`).

If the harness must be reinstalled, pin `@vitejs/plugin-react` to v4: v6 pulls Babel 8 and conflicts with shadcn’s Babel 7 tree. Do not install `@vitejs/plugin-react@6`.

```bash
npm install -D vitest @vitejs/plugin-react@^4.3.4 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom vite-tsconfig-paths
```

Shipped config (`vitest.config.ts`):

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

`vitest.setup.ts` is only:

```ts
import "@testing-library/jest-dom/vitest";
```

### Rules

- Write the tests listed for the phase **before** the production code those tests describe.
- Run `npm test`. Those new tests must fail for a real reason (missing module, missing export, wrong behavior). If they pass immediately, they are not testing the new behavior — rewrite them.
- Implement only enough production code to make **that phase’s** tests pass. Do not implement later phases in order to silence failures.
- Do not start the next phase until `npm test` is green for everything written so far.
- Assert observable behavior and failure paths. Never `expect(true).toBe(true)` or otherwise un-fail-able assertions.
- Colocate: `src/lib/password.ts` is tested by `src/lib/password.test.ts`.
- Each test must pass in isolation. `vi.clearAllMocks()` in `beforeEach`.
- Unit tests must not reach a real network, a real D1 database, or Wrangler. Mock D1 and `getCloudflareContext()` as the testing skill describes.
- Server Components are not rendered in Testing Library. Test data/logic as functions; render only client components.
- Do not add `@cloudflare/vitest-pool-workers` in this feature.

### Phase gate

At the end of each phase, all of the following must be true:

1. `npm test` — all tests written so far pass
2. The phase’s listed test cases exist and would have failed before that phase’s implementation
3. The phase’s non-test deliverables exist (migration, service, routes, pages, as applicable)

Phase 5 additionally requires `npm run lint`, `npm run build`, and a browser pass of the full teacher path.

---

## Implementation Phases

### Phase 1: Vitest harness, D1, and users migration - COMPLETED

**Objective**: Vitest runs in the repo, and a migration exists that creates the `users` table as specified.

**Tests first (expect red)**:
1. Install Vitest and config so `npm test` can execute (harness only — not a behavior test)
2. Add `migrations/users-schema.test.ts` that reads the SQL files in `migrations/` and asserts:
   - A `CREATE TABLE users` statement exists
   - Columns: `id`, `first_name`, `last_name`, `username`, `email`, `password_hash`, `created_at`, `updated_at`
   - `id` is `TEXT PRIMARY KEY`
   - `username` and `email` are `NOT NULL` and `UNIQUE`
   - `password_hash` is `NOT NULL`
   - Indexes exist on `username` and `email`
3. Run `npm test` — schema tests fail because the migration is missing or incomplete

**Then implement**:
1. Create the D1 database with Wrangler and add the `d1_databases` binding `DB` to `wrangler.jsonc`
2. Run `npm run cf-typegen` (do not hand-edit `cloudflare-env.d.ts`)
3. Create a migration for `users` as specified in Database Schema
4. Apply the migration locally only (`--local`)
5. Re-run `npm test` until the schema tests are green

**Phase gate**: `npm test` green. D1 bound. Migration applied locally.

**Deliverables**:
- `vitest.config.ts`, `test` / `test:watch` scripts
- `migrations/users-schema.test.ts`
- D1 binding in `wrangler.jsonc`
- Migration file under `migrations/`
- Local schema applied

**As-built implementation (do not recreate)**:

| Item | Location / value |
|------|------------------|
| TDD origin | Commit `fda61f1` (tests + `0001_create_users.sql` + Vitest harness). This session did **not** rewrite those files; they already existed and the schema tests were already green. |
| Harness | `vitest.config.ts` (jsdom, `globals`, `setupFiles: ["./vitest.setup.ts"]`), `vitest.setup.ts`, `package.json` scripts `test` / `test:watch` |
| Schema tests | `migrations/users-schema.test.ts` — reads every `migrations/*.sql` file and asserts the `users` table shape listed above |
| D1 binding | `wrangler.jsonc`: binding `DB`, database name `quizmaker`, `database_id` `e8b013df-10d1-4860-acf2-503f073d3878`, `migrations_dir: "migrations"` |
| Generated types | `cloudflare-env.d.ts` includes `DB: D1Database` (Wrangler-generated; not hand-edited) |
| Users migration | `migrations/0001_create_users.sql` — `TEXT` PK `id` via `lower(hex(randomblob(16)))`, required unique `username` / `email`, required `password_hash`, `created_at` / `updated_at`, indexes `idx_users_username` and `idx_users_email` |

**Verification (2026-09-03, Phase 1 only — local D1, no `--remote`)**:

1. `npm test -- migrations/users-schema.test.ts` — **1 file, 6 passed** (exit 0)
2. `npx wrangler d1 migrations apply quizmaker --local` — **No migrations to apply** (local schema already includes `0001_create_users.sql` from a prior apply). Remote was not touched (`--remote` not used).
3. `npx wrangler d1 execute quizmaker --local --command "PRAGMA table_info(users);"` — columns match the Database Schema: `id` TEXT PK (`lower(hex(randomblob(16)))` default), `first_name`, `last_name`, `username`, `email`, `password_hash`, `created_at`, `updated_at`
4. Full suite after verify: `npm test` — **18 files, 99 passed** (exit 0). Later phases add tests; Phase 1 gate is only the schema suite plus local D1 apply.

Phase 1 gate is met. Phase 2 was not started in this session.

### Phase 2: User service and password helper - COMPLETED

**Objective**: Application code can create, update, delete, and look up users without route handlers knowing SQL. Password hashing is a pure helper with tests.

**Tests first (expect red)**:

`src/lib/password.test.ts`
- `hashPassword` returns a 64-character lowercase hex string
- The same plaintext always produces the same hash
- Different plaintexts produce different hashes
- The return value is not the plaintext and does not contain it
- Output matches a known SHA-256 hex fixture for a fixed input (so the algorithm cannot silently change)

`src/lib/services/user-service.test.ts` — inject a mocked D1 (in-memory fake `prepare` / `bind` / `all`). Do not call real D1.
- `create` inserts and returns public fields (`id`, `firstName`, `lastName`, `username`, `email`) and never returns `passwordHash`
- `create` allows `username === email` for the same user
- `create` maps a unique-constraint failure on username or email to a typed conflict error
- `getByUsername` returns the user when a row exists, including `passwordHash` for login comparison (this lookup is internal; HTTP layers still must not serialize it)
- `getByUsername` returns `null` when no row exists
- `getByEmail` returns the user or `null` the same way
- `update` changes provided fields and is used (SQL includes `updated_at`)
- `delete` removes the user by id
- Queries use numbered placeholders (`?1`, `?2`), not string-concatenated SQL

Run `npm test` — these fail (modules missing or unimplemented).

**Then implement**:
1. Add `src/lib/password.ts` with `hashPassword` (Web Crypto SHA-256, hex)
2. Add `src/lib/services/user-service.ts` that receives `D1Database` and exposes:
   - `create` — insert user, return public fields
   - `getByUsername` — used by login
   - `getByEmail` — used by register uniqueness checks if not relying solely on SQLITE constraint
   - `update` — patch first name, last name, username, email, and/or password hash; bump `updated_at`
   - `delete` — remove by id
3. Use prepared statements with numbered placeholders (`?1`, `?2`)
4. Read rows via `all()` and `results[0]`, not `first()`
5. Map SQLITE unique constraint failures to a typed conflict error the routes can turn into 409
6. Re-run `npm test` until Phase 1 and Phase 2 tests are green

**Phase gate**: `npm test` green. Service has no UI imports. Password helper has no D1 imports.

**Deliverables**:
- `src/lib/password.ts` + `src/lib/password.test.ts`
- `src/lib/services/user-service.ts` + `src/lib/services/user-service.test.ts`

### Phase 3: HTTP endpoints - COMPLETED

**Objective**: Register, login, and logout work over POST, proven by route-handler unit tests.

**Tests first (expect red)**:

Mock `@opennextjs/cloudflare` `getCloudflareContext` and mock `src/lib/services/user-service` so tests never touch D1.

`src/app/api/register/route.test.ts`
- Valid body → 201, public user JSON, `passwordHash` absent from the body
- `username === email` is accepted
- Missing/invalid fields or `passwordHash` not 64 hex chars → 400 `{ error }`
- Service conflict (duplicate username or email) → 409 `{ error }`
- Unexpected service throw → 500 `{ error }`
- `create` is called with the hashed value from the body, not a plaintext password field

`src/app/api/login/route.test.ts`
- Matching username + hash → 200 public user, no `passwordHash` in JSON
- Unknown username or hash mismatch → 401 `{ "error": "Invalid username or password" }` (same message both cases)
- Invalid body → 400
- Unexpected throw → 500

`src/app/api/logout/route.test.ts`
- POST → 200 `{ "ok": true }`
- Does not call the user service

Run `npm test` — new route tests fail.

**Then implement**:
1. Zod is installed (`zod` `^4.5.4`) for request bodies in `src/lib/auth-schemas.ts`. Do not add other new dependencies for auth.
2. Implement `POST /api/register`, `POST /api/login`, `POST /api/logout`
3. Routes get `env.DB` via `getCloudflareContext({ async: true })` and call the user service
4. Register and login never echo `passwordHash`
5. Re-run `npm test` until all tests so far are green

**Phase gate**: `npm test` green. Three handlers match the status codes in Technical Requirements.

**Deliverables**:
- Three route handlers and their colocated `route.test.ts` files
- Validated request bodies
- Responses as specified above

### Phase 4: Pages and navigation - COMPLETED

**Objective**: A teacher can register or log in from the UI and reach the MCQ stub; they can log out back to login. Client components are covered with Testing Library. Login and register pages start from the shadcn login/signup blocks, adapted as specified in User Interface Requirements.

**Tests first (expect red)**:

Extract interactive forms into client components (`LoginForm`, `SignupForm`, `LogoutButton`) so they can be rendered in jsdom. Mock `fetch` and Next.js `useRouter` / `router.push`. Query by role and accessible name. Use `userEvent`, not `fireEvent`.

`src/app/page.test.tsx`
- Shows links named for register and login pointing at `/register` and `/login`

`src/components/signup-form.test.tsx`
- Renders first name, last name, username, email, password, confirm password
- Submitting with a short password or mismatched confirmation does not call `fetch`
- Successful submit calls `fetch("/api/register", …)` with JSON that includes `passwordHash` and does **not** include `password` or `confirmPassword`
- `passwordHash` is the SHA-256 hex of the typed password (spy/assert via `hashPassword` or a known fixture)
- Username equal to email is allowed (submit still proceeds)
- 201 response navigates to `/mcqs`
- 409/400 shows the server error and does not navigate
- Does not render Google signup or a forgot-password control

`src/components/login-form.test.tsx`
- Submitting hashes the password and POSTs `{ username, passwordHash }` to `/api/login` with no plaintext `password`
- 200 navigates to `/mcqs`
- 401 shows `"Invalid username or password"` (or the API error) and does not navigate
- Username field is present; stock-block email login, Google button, and forgot-password link are absent

`src/components/logout-button.test.tsx`
- Activating logout POSTs `/api/logout` then navigates to `/login`

A small test that `/mcqs` copy is a stub (heading / no question form).

Run `npm test` — UI tests fail until the components exist.

**Then implement**:
1. Replace `/` with a landing that links to register and login
2. Add `/login` and `/register` page shells from the shadcn blocks (centered `min-h-svh` layout)
3. Implement `LoginForm` and `SignupForm` from the blocks, with the field and social-login adaptations above
4. Hash on submit, POST JSON, handle errors with `FieldError`
5. Build `/mcqs` stub with logout
6. Update root layout metadata from the Create Next App defaults to Quiz Maker
7. Re-run `npm test` until all tests so far are green

**Phase gate**: `npm test` green, including UI tests that prove hash-then-POST and navigation.

**Deliverables**:
- Landing, register, login, and MCQ stub pages
- `src/components/login-form.tsx`, `src/components/signup-form.tsx`, logout control + colocated `*.test.tsx`
- Client-side hash-then-POST wiring
- Logout control

### Phase 5: Verify - COMPLETED

**Objective**: Confirm the feature actually runs. Green unit tests are necessary but not sufficient; lint, build, and a browser path still gate the feature.

**Tests first**:
- No new production behavior in this phase. If verification finds a bug, add a failing Vitest case that reproduces it, then fix until green (still TDD, just at the end).
- Run the full suite: `npm test`

**Verification results (2026-09-02)**:
1. `npm test` — **11 files, 51 passed** (exit 0)
2. `npm run lint` — exit 0
3. `npm run build` — compiled successfully. Routes: `/`, `/login`, `/register`, `/mcqs` (static); `/api/register`, `/api/login`, `/api/logout` (dynamic)
4. Browser path register → `/mcqs` → logout → login — **verified by the user locally and on the deployed Cloudflare app**
5. Duplicate username/email → 409 — covered by route unit tests (`UserConflictError`)
6. Wrong password → 401 `"Invalid username or password"` — covered by login route and login-form tests
7. Plaintext password not in the POST body — covered by signup-form and login-form tests (`passwordHash` only)
8. User also confirmed the deployed Workers app works (D1-backed register/login)

**Phase gate**: `npm test`, `npm run lint`, and `npm run build` all reported as they actually ran, plus the browser path.

**Deliverables**:
- Full Vitest suite green (51/51)
- Lint and build succeeded
- Manual path through the UI verified by the user locally and in production

---

## Technical Implementation Details

This section is the as-built contract. Function names, file paths, and snippets match the repo as of Phase 5. Prefer these over the phase “then implement” lists above.

### Commands

| Command | Purpose |
|---|---|
| `npm test` | Vitest once (`vitest run`) |
| `npm test:watch` | Vitest watch |
| `npm run lint` | ESLint |
| `npm run build` | Production Next.js build |
| `npm run dev` | Node local server — does not fully exercise Workers/D1 |
| `npm run preview` | OpenNext + local Workers runtime (use for D1-backed routes) |
| `npm run cf-typegen` | Regenerate `cloudflare-env.d.ts` after binding changes |
| `npx wrangler d1 migrations apply quizmaker --local` | Apply migrations locally only |

On Windows PowerShell, chain commands with `;`, not `&&`.

### Key Files

| Path | Role |
|---|---|
| `vitest.config.ts` | Vitest + jsdom + `@/` + `setupFiles: ["./vitest.setup.ts"]` |
| `vitest.setup.ts` | `@testing-library/jest-dom/vitest` |
| `wrangler.jsonc` | D1 binding `DB`, database `quizmaker`, `migrations_dir: "migrations"` |
| `migrations/0001_create_users.sql` | `users` table |
| `migrations/0002_create_sessions.sql` | `sessions` table (one row per browser login) |
| `migrations/users-schema.test.ts` | Asserts users migration SQL shape |
| `migrations/sessions-schema.test.ts` | Asserts sessions migration SQL shape |
| `src/lib/password.ts` | `hashPassword` (trim + SHA-256 hex), `passwordHashesMatch` |
| `src/lib/password.test.ts` | Known fixture below |
| `src/lib/services/session-service.ts` | `createSession`, `getSession`, `deleteSession` (by session id only) |
| `src/lib/session-cookie.ts` | HttpOnly `qm_session` cookie helpers |
| `src/lib/auth-schemas.ts` | Zod `registerBodySchema`, `loginBodySchema`, `firstZodMessage` |
| `src/lib/http.ts` | `jsonError`, `readJsonBody` |
| `src/app/api/register/route.ts` | `POST` → 201 / 400 / 409 / 500 |
| `src/app/api/login/route.ts` | `POST` → 200 / 400 / 401 / 500 |
| `src/app/api/logout/route.ts` | `POST` → `{ ok: true }`, deletes this browser’s session, expires cookie |
| `src/app/page.tsx` | Landing: Register + Log in |
| `src/app/register/page.tsx` | shadcn signup-block shell, renders `SignupForm` |
| `src/app/login/page.tsx` | shadcn login-block shell, renders `LoginForm` |
| `src/app/mcqs/layout.tsx` | Redirects to `/login` when this browser has no valid session |
| `src/app/mcqs/page.tsx` | Question-bank stub + `LogoutButton` |
| `src/components/login-form.tsx` | Username + password; hash then POST `/api/login` with `credentials: "include"` |
| `src/components/signup-form.tsx` | First/last/username/email/password/confirm; hash then POST `/api/register` |
| `src/components/logout-button.tsx` | POST `/api/logout` with credentials then `router.push("/login")` |
| `src/app/layout.tsx` | Title/description: Quiz Maker |
| `.cursor/rules/auth.mdc` | Auth conventions for later sprints |
| `.cursor/rules/d1.mdc` | D1 query conventions (binding exists) |
| `.cursor/skills/testing/SKILL.md` | Vitest is installed; pin plugin-react v4 |

### Password helper (shipped)

`hashPassword` **trims** plaintext before hashing. Do not drop `.trim()` or login hashes will not match padded input.

Known SHA-256 fixture used in tests (do not change the algorithm without updating this):

- plaintext: `"quiz-maker-secret"`
- digest: `c39081716b8b80c7eb8c2bf06584098c6ba939f449d95b22fb45a6a776d613a9`

```typescript
export async function hashPassword(plaintext: string): Promise<string> {
	const data = new TextEncoder().encode(plaintext.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
```

`passwordHashesMatch` is a constant-time compare of two hex strings. Login uses it; do not use `===` for hashes.

### User service (shipped names)

Exports are **`createUser` / `getUserByUsername` / `getUserByEmail` / `updateUser` / `deleteUser`**, not `create` / `getByUsername`.

```typescript
export class UserConflictError extends Error {
	readonly field: "username" | "email";
	constructor(field: "username" | "email") {
		super(`${field} already taken`);
		this.name = "UserConflictError";
		this.field = field;
	}
}
```

- Never import this module from `'use client'` files.
- Email is stored with `email.trim().toLowerCase()`.
- `queryOne` uses `db.prepare(sql).bind(...params).all()` and `results[0]`.
- Inserts/updates use `RETURNING` column list `id, first_name, last_name, username, email, password_hash`.
- Unique failures match `/UNIQUE constraint failed: users\.username/i` and `users\.email`.
- Lookups return `UserRecord` (includes `passwordHash`). `createUser` / `updateUser` return `PublicUser` (no hash).
- `updateUser` builds numbered placeholders dynamically (`?1`, `?2`, …) and always sets `updated_at = CURRENT_TIMESTAMP`.

### Zod bodies (shipped)

```typescript
const passwordHash = z.string().regex(
	/^[0-9a-f]{64}$/,
	"passwordHash must be a 64-character hex SHA-256 digest",
);

export const registerBodySchema = z.object({
	firstName: z.string().trim().min(1, "firstName is required"),
	lastName: z.string().trim().min(1, "lastName is required"),
	username: z.string().trim().min(1, "username is required"),
	email: z.email("email must be a valid email address"),
	passwordHash,
});

export const loginBodySchema = z.object({
	username: z.string().trim().min(1, "username is required"),
	passwordHash,
});
```

Zod is **v4** (`z.email()`, not `z.string().email()`). Invalid JSON → `readJsonBody` returns `null` → 400 `"Invalid JSON body"`.

### Route handlers (shipped)

OpenNext requires the Promise overload:

```typescript
const { env } = await getCloudflareContext({ async: true });
```

Do not call `getCloudflareContext()` without `{ async: true }` in this app.

Register: `createUser(env.DB, parsed.data)` → 201 public user; `UserConflictError` → 409 `{ error }` (message like `"username already taken"`); other throws → 500 `"Something went wrong"`.

Login: `getUserByUsername` then `passwordHashesMatch`. Missing user **or** mismatch → 401 `"Invalid username or password"`. Success 200 public fields only (do not spread `UserRecord`).

Logout: `return NextResponse.json({ ok: true })` — no D1, no cookies.

### Client submit (shipped)

Auth pages are client components so they can use Web Crypto, then `fetch`. They are **not** Server Actions.

```typescript
const passwordHash = await hashPassword(password);
const response = await fetch("/api/login", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ username: username.trim(), passwordHash }),
});
if (response.ok) router.push("/mcqs");
```

Register POSTs `{ firstName, lastName, username, email, passwordHash }` only — never `password` or `confirmPassword`. Errors go through shadcn `FieldError`. No `react-hook-form`. No Google. No forgot-password.

### Important Notes

- Ask before adding **new** dependencies. Vitest, `@testing-library/*`, jsdom, `vite-tsconfig-paths`, `@vitejs/plugin-react@^4`, and `zod` are already installed. Do not add bcrypt, an auth library, cookies/sessions, or a client state library unless the user asks.
- D1 is server-only. Client code talks to `/api/*`.
- Numbered SQL placeholders (`?1`, `?2`) only.
- Never apply D1 migrations with `--remote` unless the user asks.
- Never run `npm run deploy` unless the user asks.
- Login/register set `qm_session`. Logout deletes **that** session id only. Do not add JWT.
- Confirm-password exists only in the browser.
- HTTP must omit `passwordHash`; service lookups may include it for login comparison.

### Testing patterns

11 test files, 51 tests as of Phase 5. Unit tests mock D1 and `getCloudflareContext`. They do not hit Wrangler.

```typescript
vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: vi.fn(async () => ({
		env: { DB: mockDb },
	})),
}));

beforeEach(() => {
	vi.clearAllMocks();
});
```

```ts
vi.mock("server-only", () => ({}));
```

UI tests mock `fetch` and `next/navigation` `useRouter`. Query by role. Use `userEvent`. Pin `@vitejs/plugin-react` to **v4** if reinstalling (`^4.7.0` is what is in `package.json`).

---

## Acceptance Criteria

- [x] A local D1 database is configured with binding `DB` and a migration that creates `users`
- [x] A teacher can register with first name, last name, username, email, and password
- [x] The password is hashed in the browser; the POST body contains `passwordHash` and not the plaintext password
- [x] The database stores `password_hash`, never plaintext
- [x] Username and email may be the same string for one user, and registration succeeds in that case
- [x] Duplicate username returns 409
- [x] Duplicate email returns 409
- [x] Successful register responds 201 without `passwordHash` and the UI goes to `/mcqs`
- [x] A registered teacher can log in with username and password
- [x] Login hashes the typed password in the browser and compares that hash to the stored value
- [x] Wrong username or wrong password returns 401 with `"Invalid username or password"`
- [x] Successful login responds 200 without `passwordHash` and the UI goes to `/mcqs`
- [x] `/mcqs` is a stub (no MCQ functionality) and includes logout
- [x] `/mcqs` requires a valid session cookie for this browser; a new browser is sent to `/login`
- [x] Logout calls `POST /api/logout`, expires this browser’s cookie, and deletes only that session row
- [x] Logout in one browser does not delete other browsers’ sessions
- [x] No JWT, OAuth, or third-party auth library
- [x] User service supports create, update, and delete against D1
- [x] Each phase’s Vitest tests were written first, failed for a real reason, then passed after that phase’s implementation
- [x] `npm test` (Vitest) is green — **11 files, 51 passed** (2026-09-02)
- [x] `npm run lint` and `npm run build` succeed after implementation (exit 0)

---

## Success Metrics

Measured during Phase 5. No analytics stack.

| Metric | Target | Result |
|--------|--------|--------|
| New teacher can obtain an account | Register completes | Verified by user locally and on the deployed app |
| Returning teacher can sign back in | Register → logout → login reaches `/mcqs` | Verified by user |
| Password not sent in plaintext | POST has `passwordHash` only | Covered by form tests |
| Distinct teachers can coexist | Duplicate username/email → 409 | Covered by route + service tests |
| Suite stays green | `npm test` exit 0 | 51/51 passed; lint and build exit 0 |

---

## Dependencies

### External Dependencies

- Cloudflare D1 — persist users
- Web Crypto (`crypto.subtle`) — SHA-256 in the browser and on Workers (no extra package)

### Internal Dependencies

- `@opennextjs/cloudflare` `getCloudflareContext({ async: true })` — access `env.DB`
- `src/lib/services/user-service.ts` — register and login routes
- `src/lib/password.ts` — register and login **client** forms (safe to import from `'use client'`)
- shadcn/ui `button`, `card`, `field`, `input`, `label`
- `.cursor/skills/testing/SKILL.md` — Vitest conventions

### Installed packages (this feature)

- `zod` `^4.5.4`
- `vitest`, `@vitejs/plugin-react@^4.7.0`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `vite-tsconfig-paths`

### Environment

- No secrets are required for this hashing scheme.
- After changing D1 bindings, run `npm run cf-typegen`. Do not hand-edit `cloudflare-env.d.ts`.
- Local Wrangler/D1 state stays gitignored.
- This repo’s `wrangler.jsonc` still has placeholder `database_id` `00000000-0000-0000-0000-000000000001`. The user later **deployed successfully**, so production may already be bound to a real D1 (dashboard or a local-only ID that was not committed). If a real ID exists, **commit it** so the next agent does not create a second database. Do not run `d1 create` again unless the user asks. Never apply migrations `--remote` unless asked.

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `npm run dev` (Node) does not expose D1 the same way as Workers.
- **Mitigation**: Treat `npm run preview` as the source of truth for database-backed routes. The user confirmed both local and deployed paths work.

- **Risk**: Client SHA-256 hashes are unsalted and replayable; a leaked `password_hash` is enough to log in.
- **Mitigation**: Accepted for this feature (see Cut). Do not log hashes. A later sprint can move to a salted slow hash on the server and real sessions.

- **Risk**: Unique constraint errors from D1 may not match the expected SQLITE string.
- **Mitigation**: Service already maps `UNIQUE constraint failed: users.username|email`. If a future D1 driver changes the message, 409s become 500s — update the regex.

- **Risk**: Logout that deletes every session for a user would sign other browsers out.
- **Mitigation**: `deleteSession` uses `WHERE id = ?1` only. `/mcqs` layout validates the cookie against D1.

- **Risk**: Production D1 will 500 on login until `0002_create_sessions.sql` is applied remotely.
- **Mitigation**: Apply locally with `--local`. Remote apply only when the user asks. Document this in Current Status.

### User Experience Risks

- **Risk**: Teachers try to log in with email when the field is labeled username.
- **Mitigation**: Label is “Username”. Helper text: if they registered with the same value for both, that value is their username.

- **Risk**: Server only validates that `passwordHash` is 64 hex chars.
- **Mitigation**: Client enforces min length 8 and confirm-password match before hashing.

- **Risk**: Logout appears to do nothing if the teacher uses the back button to `/mcqs`.
- **Mitigation**: Expected without sessions. Do not fake a protected route.

---

## Troubleshooting Guide

### D1 binding missing at runtime

**Problem**: Register/login throw because `env.DB` is undefined.
**Cause**: `wrangler.jsonc` has no `d1_databases` binding, types were not regenerated, or the handler used the sync `getCloudflareContext()` overload.
**Solution**: Binding `DB` already exists. Use `await getCloudflareContext({ async: true })`. Run `npm run cf-typegen` after binding changes. Use `npm run preview` for Workers/D1.
**Code Reference**: `src/app/api/register/route.ts`, `wrangler.jsonc`

### Unique username/email not returning 409

**Problem**: Duplicate register returns 500.
**Cause**: SQLITE constraint error string not mapped.
**Solution**: Match `UNIQUE constraint failed: users.username` / `users.email` in `rethrowConflict`, throw `UserConflictError`.
**Code Reference**: `src/lib/services/user-service.ts`

### Hash comparison always fails

**Problem**: Register works, login always 401.
**Cause**: Client hex encoding differs, extra whitespace, or the server hashed a second time.
**Solution**: One shared `hashPassword`; trim plaintext; store and compare the hash as-is. Do not SHA-256 on the server.
**Code Reference**: `src/lib/password.ts`

### New tests pass before any implementation

**Problem**: A phase’s tests are green on the first run, before the production code exists.
**Cause**: The tests do not assert the new behavior.
**Solution**: Rewrite until they fail for the missing behavior. Only then implement.

### @vitejs/plugin-react peer conflict with Babel 8

**Problem**: `npm install` of latest `@vitejs/plugin-react` fails with `ERESOLVE` against `@babel/core@7` from shadcn.
**Cause**: plugin-react v6 wants Babel 8.
**Solution**: Pin `@vitejs/plugin-react@^4.3.4` (repo has `^4.7.0`).
**Code Reference**: `package.json`

### Placeholder `database_id` vs production D1

**Problem**: Local `wrangler.jsonc` still shows `00000000-0000-0000-0000-000000000001` even though deploy worked.
**Cause**: Remote D1 may have been created/bound outside this file, or the real ID was never committed.
**Solution**: Run `npx wrangler d1 list` locally (after login). If `quizmaker` already exists, put that ID in `wrangler.jsonc` and commit it. Do not create a second database.
**Code Reference**: `wrangler.jsonc`

### Git push to GitHub fails with cancelled credential dialog

**Problem**: `git push` exits 128: `could not read Username for 'https://github.com'` / `User cancelled dialog`.
**Cause**: HTTPS GitHub auth prompt was cancelled.
**Solution**: User must complete GitHub login (or switch to SSH). Agents should not loop on push.

### Logout signs every browser out

**Problem**: Logging out in Chrome also logs out Firefox.
**Cause**: Logout deleted all sessions for the user (`WHERE user_id = …`).
**Solution**: Delete only `WHERE id = ?1` for this browser’s `qm_session` cookie.
**Code Reference**: `src/lib/services/session-service.ts`, `src/app/api/logout/route.ts`

### New browser still sees `/mcqs` without logging in

**Problem**: Incognito or another browser can open `/mcqs` with no password.
**Cause**: `/mcqs` was not checking a session, or production D1 is missing the `sessions` table.
**Solution**: Keep `src/app/mcqs/layout.tsx`. Apply `0002_create_sessions.sql` locally (`--local`). For production, apply remote only when the user asks.
**Code Reference**: `src/app/mcqs/layout.tsx`

### Cursor debug logs and agent instrumentation

**Problem**: `debug-*.log` or `#region agent log` fetch calls appear in the working tree.
**Cause**: A debug session left ingest hooks in source or log files at the repo root / `.cursor/`.
**Solution**: Delete the logs. Restore source files to remove `#region agent log` blocks. Do not commit either. `debug-*.log` and `.cursor/debug-*.log` are gitignored.
**Code Reference**: `.gitignore`

---

## Follow-on work (next sprint)

Register / login / logout is **done**. Next product work is the shared MCQ question bank on `/mcqs`.

Write a **new** technical PRD for that feature. Do not reopen this one except to record an auth bugfix.

Constraints the next agent must keep:

1. **Do not re-build auth.** Reuse `createUser`, `getUserByUsername`, `hashPassword`, and the existing pages/routes.
2. **`/mcqs` requires a session.** Reuse `getSession` and `qm_session`. Do not add JWT/OAuth. Logout must stay per-browser (`DELETE … WHERE id = ?1`).
3. **Keep client-side SHA-256** unless the user asks to change hashing.
4. **User service already has `updateUser` / `deleteUser`.** Use them; do not duplicate SQL in routes.
5. **TDD with existing Vitest.** Do not reinstall the harness. Pin plugin-react v4 if adding related packages.
6. **Ask before new dependencies.** D1, Vitest, and Zod are already in the stack.
7. **New tables** belong in a new migration under `migrations/`, applied `--local` only unless the user asks otherwise.
8. **shadcn forms** use `field` + `FieldError`, not a Form component, and not `react-hook-form` unless asked.

---

## Notes for AI Agents

This PRD is **complete**. Use it as context, not as a build plan.

1. Do not implement Phases 1–5 again. The code and tests already exist.
2. Do not add MCQ CRUD, OAuth, or JWT in the name of “finishing auth”. Sessions are already per-browser HttpOnly cookies.
3. New work: write a new PRD, TDD with Vitest, follow `.cursor/skills/testing/SKILL.md` and `.cursor/rules/auth.mdc`.
4. Keep `AGENTS.md` Project current when the product changes again.
5. Never apply D1 migrations remotely and never deploy unless asked.
6. Cite code as `filepath:line-number`.
7. If you change hashing, schema, or HTTP contracts, update **this** PRD in the same change.
8. Never commit Cursor debug instrumentation (`#region agent log`, ingest URLs, `debug-*.log`). Delete those files; they are local only.

---

## Current Status

**Last Updated**: 2026-09-03
**Current Phase**: Phase 1 complete (re-verified this session). Phases 2–5 remain shipped from prior work and were **not** re-implemented.
**Status**: Phase 1 COMPLETED — Vitest harness, D1 binding `DB` / `quizmaker`, `migrations/0001_create_users.sql`, schema tests green, local D1 schema confirmed. Register / login / logout plus HttpOnly `qm_session` is already the as-built contract; this session did not start Phase 2.
**Git**: Branch `feature/register-login-logout`. Phase 1 implementation landed in `fda61f1`; this session records re-verification only.
**Verification (2026-09-03, this session)**:
- Phase 1 tests: `migrations/users-schema.test.ts` — **6/6 passed** (exit 0)
- Local D1: `npx wrangler d1 migrations apply quizmaker --local` — **No migrations to apply** (local schema current; not remote)
- Local `users` table: `PRAGMA table_info(users)` — 8 columns match the PRD Database Schema
- Full suite: `npm test` — **18 files / 99 passed** (exit 0)
**Next Steps**: Do not start Phase 2 of this PRD (it is already shipped). Next product work is a new MCQ CRUD PRD on `/mcqs`.
