Date created: 2026-09-02
Date last modified: 2026-09-02

# Register, Login, and Logout - Technical PRD

## Overview/Problem

Quiz Maker is a greenfield application whose long-term purpose is a shared test bank of multiple-choice questions that several teachers can build together. None of that collaboration is possible until teachers can become distinct users of the system. Today the starter app has no database, no user model, and no way to register, sign in, or sign out. This feature introduces a `users` table, a user service, and HTTP endpoints plus pages so a teacher can create an account, log in, log out, and land on a placeholder MCQ page. The question bank itself is not part of this work.

---

## Hypothesis

We believe that a simple register, login, and logout flow backed by a hashed-password user table will let multiple teachers establish distinct accounts and reach a shared application shell, which is the prerequisite for later collaborative question-bank work.

---

## Scope

### In Scope

- Cloudflare D1 database binding for this app (none exists yet)
- A `users` table and a Wrangler D1 migration to create it
- User fields: primary key, first name, last name, username, email, and a hashed password
- Username and email stored as separate unique columns; a given user may set them to the same value (for example both `teacher@school.edu`)
- Client-side hashing of the password the teacher types, with the hash sent in the HTTP POST body for register and login (plaintext passwords are not sent over the wire)
- Server stores the received hash in D1 and compares hashes on login (no second transformation unless documented below)
- A user service in `src/lib/services/` with create, update, delete, and the lookups register/login need
- HTTP POST endpoints for register, login, and logout; register and login call the user service
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
- Tokens (JWT, API keys, bearer auth) — this phase only checks credentials and then navigates
- Session management, cookies, and server-side login state — explicitly deferred; logout does not invalidate a server session because none exists
- Slow salted password hashing (bcrypt / Argon2 / PBKDF2) — this phase uses SHA-256 via Web Crypto so the client can hash before POST without a new native dependency on Workers; a later sprint can replace this with a salted server-side KDF
- Protecting `/mcqs` from unauthenticated visits — without sessions there is nothing to gate the route; the stub is reachable by URL
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

### Password hashing

Hashing happens in the browser before the POST. Use the Web Crypto API (`crypto.subtle.digest`) with SHA-256 and hex-encode the 32-byte digest. The same helper must be importable from client components (no D1, no `getCloudflareContext`).

```typescript
export async function hashPassword(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

**Request Body:** none (empty JSON object is acceptable)

**Response:**

- Success (200): `{ "ok": true }`

Logout does not look up a user and does not clear a cookie or token. It exists so the UI has a real endpoint to call. After 200, the client navigates to `/login`. Visiting `/mcqs` after logout is still possible in this phase.

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
- A Logout control that POST `/api/logout` then navigates to `/login`
- No question forms, lists, or APIs
- No route guard

#### Logout

- Triggered from `/mcqs` (and any future authenticated chrome)
- POST `/api/logout`, then navigate to `/login`
- Do not wait on a session cookie

---

## Test-Driven Development

Every implementation phase is **red → green → (then) done**. Tests are the first work product of the phase, not a cleanup step. A phase is not complete because files exist; it is complete when that phase’s Vitest suite is green **and** the phase’s acceptance checks pass.

### Framework

Use **Vitest**. It is the project’s preferred unit-testing framework (see `.cursor/skills/testing/SKILL.md`). It is not installed yet. Installing it is explicitly in scope for Phase 1 because the user asked for this approach.

Install (devDependencies). Pin `@vitejs/plugin-react` to v4: v6 pulls Babel 8 and conflicts with shadcn’s Babel 7 tree.

```bash
npm install -D vitest @vitejs/plugin-react@^4.3.4 @testing-library/react @testing-library/user-event jsdom vite-tsconfig-paths
```

Add `vitest.config.ts` and scripts `test` (`vitest run`) and `test:watch` (`vitest`) exactly as the testing skill specifies. `vite-tsconfig-paths` is required so `@/` imports resolve.

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
1. Propose adding Zod (not installed) for request bodies; Vitest packages are already approved. Do not add other new dependencies
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

### Phase 5: Verify - PLANNED

**Objective**: Confirm the feature actually runs. Green unit tests are necessary but not sufficient; lint, build, and a browser path still gate the feature.

**Tests first**:
- No new production behavior in this phase. If verification finds a bug, add a failing Vitest case that reproduces it, then fix until green (still TDD, just at the end).
- Run the full suite: `npm test`

**Then verify**:
1. `npm test` — entire suite green (report the actual count/result)
2. `npm run lint`
3. `npm run build`
4. Exercise register → `/mcqs` → logout → login in the browser against the running app
5. Confirm duplicate username/email returns 409
6. Confirm wrong password returns 401 without leaking which field failed
7. Confirm plaintext password is not in the network payload (only `passwordHash`)
8. Use `npm run preview` if checking D1/Workers behavior; `npm run dev` will not surface all Workers issues

**Phase gate**: `npm test`, `npm run lint`, and `npm run build` all reported as they actually ran, plus the browser path.

**Deliverables**:
- Full Vitest suite green
- Lint and build results reported as they actually ran
- Manual path through the UI verified

---

## Technical Implementation Details

### Key Files

- `vitest.config.ts` — Vitest + jsdom + `@/` path resolution
- `wrangler.jsonc` — D1 `DB` binding for database `quizmaker` (local placeholder `database_id` until a remote D1 is created)
- `migrations/0001_create_users.sql` — `users` table
- `migrations/users-schema.test.ts` — asserts migration SQL shape
- `src/lib/password.ts` / `src/lib/password.test.ts` — `hashPassword` (SHA-256 hex) and `passwordHashesMatch`
- `src/lib/services/user-service.ts` / `src/lib/services/user-service.test.ts` — D1-backed `createUser`, `getUserByUsername`, `getUserByEmail`, `updateUser`, `deleteUser`; `UserConflictError` for unique username/email
- `src/lib/auth-schemas.ts` — Zod register/login bodies; `passwordHash` must be 64 hex chars
- `src/lib/http.ts` — JSON error helper and body reader
- `src/app/api/register/route.ts` / `route.test.ts` — `POST` register
- `src/app/api/login/route.ts` / `route.test.ts` — `POST` login
- `src/app/api/logout/route.ts` / `route.test.ts` — `POST` logout
- `src/app/page.tsx` / `src/app/page.test.tsx` — landing with Register and Log in
- `src/app/register/page.tsx` — shadcn signup-block shell
- `src/app/login/page.tsx` — shadcn login-block shell
- `src/app/mcqs/page.tsx` / `src/app/mcqs/page.test.tsx` — MCQ stub
- `src/components/login-form.tsx` / `login-form.test.tsx` — adapted shadcn login block
- `src/components/signup-form.tsx` / `signup-form.test.tsx` — adapted shadcn signup block
- `src/components/logout-button.tsx` / `logout-button.test.tsx` — POST logout then `/login`
- `src/app/layout.tsx` — Quiz Maker title/description
- `vitest.setup.ts` — Testing Library jest-dom matchers
- `AGENTS.md` — after this feature ships, update the Project blurb so it is no longer “unmodified starter”

### Implementation Patterns

```typescript
// User service: bind D1, never import this module from 'use client' files
export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
};

export type CreateUserInput = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  passwordHash: string;
};

// Route handlers obtain DB from Cloudflare context, then call the service
import { getCloudflareContext } from "@opennextjs/cloudflare";

const { env } = await getCloudflareContext({ async: true });
const user = await createUser(env.DB, input);
```

Inserts and updates use `RETURNING` and `all().results[0]`. Unique constraint failures become `UserConflictError` with `field: "username" | "email"`. Lookups return `UserRecord` (includes `passwordHash`); `createUser` / `updateUser` return `PublicUser` without it.

```typescript
// Client submit handler (register / login): hash, then POST JSON
const passwordHash = await hashPassword(password);
const response = await fetch("/api/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ firstName, lastName, username, email, passwordHash }),
});
```

### Important Notes

- Ask before adding dependencies. **Vitest and the testing-skill packages are approved for this feature.** Zod is expected for body validation (project Next.js convention) and still must be proposed before install. Do not add bcrypt, an auth library, or a client state library.
- Follow TDD per phase: tests first (red), then production code (green). Do not write the implementation and backfill tests afterward.
- D1 is server-only. The user service must not be imported into client components. Client code talks to `/api/*`.
- Numbered SQL placeholders (`?1`, `?2`) only.
- Never apply D1 migrations with `--remote`.
- Never run `npm run deploy` unless the user asks.
- There is no current-user context after login. Do not build middleware that checks a cookie.
- `update` and `delete` on the service are required even though this feature’s UI does not call them.
- Confirm-password exists only in the browser; it is not a database column and is not sent to the API.
- `getByUsername` / `getByEmail` may include `passwordHash` for the login route to compare. HTTP responses must still omit it. Tests should catch a leak at the route layer, not by stripping the field off the service lookup.

### Testing patterns

```typescript
// Mock Cloudflare context in route tests — never call real D1
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

---

## Acceptance Criteria

- [x] A local D1 database is configured with binding `DB` and a migration that creates `users`
- [ ] A teacher can register with first name, last name, username, email, and password
- [ ] The password is hashed in the browser; the POST body contains `passwordHash` and not the plaintext password
- [ ] The database stores `password_hash`, never plaintext
- [ ] Username and email may be the same string for one user, and registration succeeds in that case
- [ ] Duplicate username returns 409
- [ ] Duplicate email returns 409
- [ ] Successful register responds 201 without `passwordHash` and the UI goes to `/mcqs`
- [ ] A registered teacher can log in with username and password
- [ ] Login hashes the typed password in the browser and compares that hash to the stored value
- [ ] Wrong username or wrong password returns 401 with `"Invalid username or password"`
- [ ] Successful login responds 200 without `passwordHash` and the UI goes to `/mcqs`
- [x] `/mcqs` is a stub (no MCQ functionality) and includes logout
- [x] Logout calls `POST /api/logout` and the UI goes to `/login`
- [ ] No cookies, session store, or tokens are introduced
- [ ] No social login
- [x] User service supports create, update, and delete against D1
- [ ] Each phase’s Vitest tests were written first, failed for a real reason, then passed after that phase’s implementation
- [ ] `npm test` (Vitest) is green
- [ ] `npm run lint` and `npm run build` succeed after implementation

---

## Success Metrics

These are directional for a first auth slice with no analytics stack yet. Measure manually during verification.

| Metric | Target | How Measured |
|--------|--------|--------------|
| New teacher can obtain an account | Register completes and a `users` row exists | D1 local query after a successful POST `/api/register` |
| Returning teacher can sign back in | Login with the same username and password reaches `/mcqs` | Manual path: register → logout → login |
| Password not sent in plaintext | Network payload has only `passwordHash` | Browser devtools Network tab on register and login |
| Distinct teachers can coexist | Two users with different usernames both register | Two registration attempts, two rows |
| Phase tests stay green | `npm test` exits 0 after every phase | Vitest run in that phase’s gate |

---

## Dependencies

### External Dependencies

- Cloudflare D1 — persist users
- Web Crypto (`crypto.subtle`) — SHA-256 in the browser and on Workers (no extra package)

### Internal Dependencies

- `@opennextjs/cloudflare` `getCloudflareContext()` — access `env.DB` in route handlers
- `src/lib/services/user-service.ts` — used by register and login routes
- `src/lib/password.ts` — used by register and login pages
- shadcn/ui `button`, `card`, `field`, `input`, `label` — forms
- `.cursor/skills/testing/SKILL.md` — Vitest setup, colocation, and mocking conventions

### Approved packages (this feature)

- Vitest and the testing skill’s devDependencies: `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `vite-tsconfig-paths`
- `zod` — validate register and login JSON bodies in route handlers

### Environment

- No new secrets are required for this hashing scheme
- After adding D1, regenerate types with `npm run cf-typegen`
- Keep local Wrangler/D1 state out of git (already gitignored)
- `wrangler.jsonc` currently uses placeholder `database_id` `00000000-0000-0000-0000-000000000001`. Wrangler is not logged in on this machine, so a remote D1 was not created. After `npx wrangler login` and `npx wrangler d1 create quizmaker`, replace that ID with the real one. Local `--local` migrations already apply against this placeholder.

---

## Risks and Mitigation

### Technical Risks

- **Risk**: `npm run dev` (Node) does not expose D1 the same way as Workers, so register/login may work in preview and fail in `dev`, or the reverse.
- **Mitigation**: Treat `npm run preview` as the source of truth for database-backed routes. Document if `dev` cannot reach D1.

- **Risk**: Client SHA-256 hashes are unsalted and replayable; a leaked `password_hash` is enough to log in.
- **Mitigation**: Accept for this phase (see Cut). Do not log hashes. A later sprint should move to a salted slow hash on the server and real sessions.

- **Risk**: Unique constraint errors from D1 may not be obvious in the driver error shape.
- **Mitigation**: Catch constraint failures in the service and map them to a 409; add a troubleshooting note if the actual error string differs.

- **Risk**: Without sessions, “logged in” is only a client navigation. Teachers may think `/mcqs` is private.
- **Mitigation**: Stub copy can stay neutral. Do not imply authorization. Next sprint that needs a real user should add sessions.

### User Experience Risks

- **Risk**: Teachers try to log in with email when the field is labeled username.
- **Mitigation**: Label the field “Username”. Helper text: if they registered with the same value for both, that value is their username.

- **Risk**: Hashing before POST means a typo in the confirm-password field is the only client-side check; the server cannot know the password was weak beyond hash format.
- **Mitigation**: Enforce minimum length and match-confirm on the client before hashing. Server validates `passwordHash` is 64 hex characters.

- **Risk**: Logout appears to “do nothing” if the teacher uses the back button to `/mcqs`.
- **Mitigation**: Expected without sessions. Do not fake a protected route.

---

## Troubleshooting Guide

Populate this section when bugs are found during implementation. Starters:

### D1 binding missing at runtime

**Problem**: Register/login throw because `env.DB` is undefined.
**Cause**: `wrangler.jsonc` has no `d1_databases` binding, or types were not regenerated.
**Solution**: Add the binding Wrangler printed at `d1 create`, run `npm run cf-typegen`, restart preview.
**Code Reference**: `wrangler.jsonc`

### Unique username/email not returning 409

**Problem**: Duplicate register returns 500.
**Cause**: SQLITE constraint error not mapped in the user service.
**Solution**: Inspect the caught error, match on constraint/code, throw a typed conflict the route turns into 409.
**Code Reference**: `src/lib/services/user-service.ts`

### Hash comparison always fails

**Problem**: Register works, login always 401.
**Cause**: Client hex encoding differs between register and login, extra whitespace, or the server hashed a second time.
**Solution**: One shared `hashPassword` helper; trim the plaintext before hashing; store and compare the hash as-is.
**Code Reference**: `src/lib/password.ts`

### New tests pass before any implementation

**Problem**: A phase’s tests are green on the first run, before the production code exists.
**Cause**: The tests do not assert the new behavior, or they import placeholders that already satisfy the assertions.
**Solution**: Rewrite until they fail for the missing behavior (cannot find module, unimplemented function, or wrong result). Only then implement.

### @vitejs/plugin-react peer conflict with Babel 8

**Problem**: `npm install` of latest `@vitejs/plugin-react` fails with `ERESOLVE` against `@babel/core@7` from shadcn.
**Cause**: plugin-react v6 wants Babel 8.
**Solution**: Pin `@vitejs/plugin-react@^4.3.4`.
**Code Reference**: `package.json`

### Remote D1 not created

**Problem**: `npx wrangler d1 create` cannot run; Wrangler reports not authenticated.
**Cause**: No `wrangler login` session on this machine. Remote database create is also blocked until the user explicitly authorizes it.
**Solution**: Keep the local placeholder `database_id` for `--local` work. When ready: `npx wrangler login`, then `npx wrangler d1 create quizmaker`, then put the printed ID into `wrangler.jsonc`. Do not apply migrations with `--remote` unless asked.
**Code Reference**: `wrangler.jsonc`

---

## Notes for AI Agents

When working with this PRD:

1. Start from Overview and Hypothesis — this feature exists so multiple teachers can have accounts, not to build the question bank
2. Scope is binding — do not add MCQ CRUD, OAuth, JWT, cookies, or session middleware
3. **Implement test-first.** For each phase: write the listed Vitest files, run `npm test` and confirm red, then implement until green. Do not skip the red run
4. Do not begin the next phase while `npm test` is red
5. Follow `.cursor/skills/testing/SKILL.md` for config, colocation, mocking, and what makes a test worth writing
6. Update phase status markers as work progresses (`PLANNED` → `IN PROGRESS` → `COMPLETED`)
7. Record real file paths under Technical Implementation Details once they exist
8. Check off Acceptance Criteria only when the behavior has been verified (tests green is not enough for UI; Phase 5 still needs a browser path)
9. Add Troubleshooting entries when something actually breaks
10. Vitest packages and Zod are approved for this feature. Do not add other auth libraries
11. Never apply D1 migrations remotely and never deploy unless asked
12. Cite code as `filepath:line-number`
13. After the feature works, update `AGENTS.md` Project so it describes Quiz Maker and this auth slice instead of an unmodified starter

---

## Current Status

**Last Updated**: 2026-09-02
**Current Phase**: Phase 4 - Pages and navigation
**Status**: COMPLETED — waiting for review before Phase 5
**Next Steps**: After review, run Phase 5 verification (`npm test`, lint, build, and a browser path through register → MCQ stub → logout → login).
