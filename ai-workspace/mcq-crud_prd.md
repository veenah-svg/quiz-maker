Date created: 2026-09-03
Date last modified: 2026-09-04

# MCQ CRUD - Technical PRD

## Overview/Problem

Quiz Maker already lets teachers register, sign in, and manage a shared question bank on `/mcqs`. They can list, confirm-delete, **create/edit**, and **preview/attempt** questions. Attempts are scored by `checkQuestionAttemptAction` from D1 `is_correct`, never a client boolean. Session-gated **Server Actions** call the MCQ service.

Do **not** re-implement register, login, logout, or sessions. Reuse `getSession`, `qm_session`, and `env.DB` from `ai-workspace/register-login-logout_prd.md`.

---

## Hypothesis

We believe that a D1-backed question service with Zod validation, owner checks, and cascaded choices will let several teachers share a test bank without overwriting each other’s questions, which is the prerequisite for MCQ HTTP and UI work.

---

## Scope

### In Scope

- D1 `questions` and `choices` tables (local migration only)
- Zod validation for create/update payloads (stem, 2–6 choices, exactly one correct)
- `src/lib/services/mcq-service.ts` create, get, list, update, and delete
- Numbered SQL placeholders (`?1`, `?2`); no concatenated user input
- Ownership: mutations require `owner_id` to match the acting teacher
- Typed errors for validation, not-found, and forbidden
- Choice `position` ordering
- SQLite `INTEGER` 0/1 mapped to boolean `isCorrect`
- `ON DELETE CASCADE` from users→questions and questions→choices
- Session-gated Server Actions (`src/app/mcqs/actions.ts`) as the Client → Server Action → Service → DB boundary
- Server-side attempt correctness (`checkQuestionAttempt`) that reads stored `is_correct`, never a client boolean
- Preview/attempt UI that submits `{ questionId, choiceId }` only and shows server Correct/Incorrect feedback
- Vitest tests written first for this phase

### Out of Scope (later phases)

- Persisting attempt history or a student quiz-taking page
- Sharing controls beyond “any signed-in teacher can read the bank”
- Tags, subjects, images, or rich text

### Cut

- Soft delete — hard delete plus CASCADE is enough
- Editing a single choice in isolation — updates replace the choice set
- Listing only “my questions” — the bank is shared; ownership gates writes, not reads
- `@cloudflare/vitest-pool-workers` — unit tests mock D1
- REST `/api/questions` — non-auth mutations use Server Actions (`.cursor/rules/nextjs.mdc`). Auth stays on `/api/register|login|logout` because those forms must hash then POST JSON.

---

## Technical Requirements

### Database Schema

```sql
CREATE TABLE questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stem TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_questions_owner_id ON questions (owner_id);

CREATE TABLE choices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  question_id TEXT NOT NULL,
  label TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX idx_choices_question_id ON choices (question_id);
CREATE UNIQUE INDEX idx_choices_question_position ON choices (question_id, position);
```

| Rule | Detail |
|------|--------|
| Numbered placeholders | All queries use `?1`, `?2`, … never string-concatenated SQL |
| Ownership | `createQuestion` stores `owner_id` from the session user, not the body. `updateQuestion` / `deleteQuestion` load the row, throw `McqNotFoundError` if missing, `McqForbiddenError` if `owner_id` does not match, then mutate with `WHERE id = ? AND owner_id = ?` |
| Error handling | `McqValidationError` (Zod), `McqNotFoundError`, `McqForbiddenError`. Unexpected D1 errors propagate |
| Choice ordering | Insert `position` from array index (0-based). Select `ORDER BY position ASC`. Mapper also sorts by `position` |
| Boolean mapping | Store `is_correct` as `1` / `0`. Public API uses `isCorrect: boolean`. Never bind JS `true`/`false` |
| Cascade | Deleting a question deletes its choices via FK. Deleting a user deletes their questions (and thus choices). The service does **not** `DELETE FROM choices` when deleting a question |

### API Endpoints

MCQ mutations are **Server Actions**, not `/api/questions` route handlers. `/mcqs` layout still requires `qm_session`. Actions resolve the actor from that cookie and pass `session.userId` into the service. They never take `ownerId` from the client payload. They never call `db.prepare` / SQL; D1 stays behind `session-service` and `mcq-service`.

Every action returns a serializable result:

```ts
type McqActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "unauthorized" | "validation" | "not_found" | "forbidden" | "server"; error: string };
```

| Action | Calls | Success | Error codes |
|--------|--------|---------|-------------|
| `listQuestionsAction` | `listQuestions(db)` | `{ ok: true, data: Question[] }` | unauthorized, server |
| `getQuestionAction(id)` | `getQuestion(db, id)` after `questionIdSchema` | `{ ok: true, data: Question }` | unauthorized, validation, not_found, server |
| `createQuestionAction(input)` | `createQuestion(db, session.userId, parsed)` after `createQuestionSchema` | `{ ok: true, data: Question }` | unauthorized, validation, server |
| `updateQuestionAction(id, input)` | `updateQuestion(...)` after id + `updateQuestionSchema` | `{ ok: true, data: Question }` | unauthorized, validation, not_found, forbidden, server |
| `deleteQuestionAction(id)` | `deleteQuestion(...)` after `questionIdSchema` | `{ ok: true, data: { deleted: true } }` | unauthorized, validation, not_found, forbidden, server |
| `checkQuestionAttemptAction(input)` | `checkQuestionAttempt(db, parsed)` after `questionAttemptSchema` | `{ ok: true, data: QuestionAttemptResult }` | unauthorized, validation, not_found, server |

Zod runs in the action **before** the service is called. Ownership is still enforced in the service (`McqForbiddenError` → `code: "forbidden"`). Attempt `isCorrect` is decided from D1, not the client.

### User Interface Requirements

`/mcqs` is the signed-in dashboard. `src/app/mcqs/layout.tsx` still redirects missing sessions to `/login` on the server (no client auth flash). The list is a client component that calls Server Actions and branches on `ok`. Do not import `mcq-service` into `'use client'` files.

| Surface | Behavior |
|---------|----------|
| Heading | “Question bank” plus Log out (unchanged auth chrome) |
| Create question | Link to `/mcqs/new` |
| Table | Stem, choice count, Edit / Preview / Delete (unique `aria-label`s include the stem) |
| Empty | “No questions yet” |
| Loading | “Loading questions…” (`role="status"`) |
| Error | Action `error` string |
| Unauthorized list | `router.push("/login")` |
| Preview | Link to `/mcqs/[id]/preview` |
| Delete | Confirm dialog names the stem; Cancel does not call the action; Confirm calls `deleteQuestionAction`; forbidden keeps the row and shows the error |
| Edit | Link to `/mcqs/[id]/edit` |
| Create form (`/mcqs/new`) | Stem labeled “Question” (schema has no description column), 2–6 choices, exactly one correct via radios, Add/Remove, Save/Cancel |
| Edit form (`/mcqs/[id]/edit`) | Loads via `getQuestionAction`, saves via `updateQuestionAction`; unauthorized → `/login`; server errors stay on the form |
| Attempt (`/mcqs/[id]/preview`) | Loads stem and choice labels only (no Correct badge). Choices are a fieldset. Check answer calls `checkQuestionAttemptAction({ questionId, choiceId })`. Feedback is the server `isCorrect`. Try again clears the recorded result. Back returns to `/mcqs`. Unauthorized → `/login`. |

---

## Implementation Phases

### Phase 1: Schema - COMPLETED (delivered with Phase 2)

**Objective**: D1 can store questions and ordered choices with cascade and ownership columns.

The questions migration did not exist before this work, and cascade/ownership cannot be real without it, so the schema shipped in the same change as Phase 2.

**Deliverables**:
- `migrations/0003_create_questions.sql`
- `migrations/questions-schema.test.ts`

### Phase 2: Data Access & Validation - COMPLETED

**Objective**: Application code can create, read, update, and delete questions against D1 without route handlers knowing SQL. Payloads are validated. Ownership, ordering, boolean mapping, and cascade rules are enforced.

**Tests first (expect red)**:
1. Schema tests for `CREATE TABLE questions` / `choices`, `owner_id`, `is_correct INTEGER`, `position`, and `ON DELETE CASCADE`
2. Zod tests: trim, empty stem, 2–6 choices, exactly one correct
3. Service tests: numbered placeholders, `isCorrect` ↔ 0/1, choice positions, owner forbid/not-found, delete does not `DELETE FROM choices`

**Then implement**:
1. Zod schemas in `src/lib/mcq-schemas.ts`
2. `src/lib/services/mcq-service.ts` with mocked D1 in tests
3. Apply `0003_create_questions.sql` locally only

**Phase gate**: `npm test` green. `npm run lint` exit 0. Local migration applied. No `--remote`.

**Deliverables**:
- `src/lib/mcq-schemas.ts` + `src/lib/mcq-schemas.test.ts`
- `src/lib/services/mcq-service.ts` + `src/lib/services/mcq-service.test.ts`
- Local `questions` / `choices` tables

**As-built implementation (do not recreate)**:

| Item | Location / value |
|------|------------------|
| TDD origin | Commit `0dea9f4` (`migrations/0003_create_questions.sql`, schema/Zod/service tests, then `mcq-schemas.ts` / `mcq-service.ts`). This session did **not** rewrite those files; they already existed and the Phase 2 tests were already green. |
| Schema tests | `migrations/questions-schema.test.ts` — `questions` / `choices`, TEXT PKs, `owner_id` FK CASCADE, `is_correct INTEGER`, `position`, indexes |
| Zod | `src/lib/mcq-schemas.ts` — trim, non-empty stem/labels, 2–6 choices, exactly one `isCorrect` |
| Service | `src/lib/services/mcq-service.ts` — `createQuestion` / `getQuestion` / `listQuestions` / `updateQuestion` / `deleteQuestion`; `McqValidationError` / `McqNotFoundError` / `McqForbiddenError` |
| Ownership | `ownerId` is a service argument (session user), never from the JSON body. Mutations `WHERE id = ?2 AND owner_id = ?3` after a load that throws not-found vs forbidden |
| Choices | `position` is 0-based array index; SELECT `ORDER BY position ASC`; mapper also sorts. `isCorrect` ↔ SQLite `1`/`0` via `toSqliteBool` / `fromSqliteBool` |
| Cascade | `deleteQuestion` issues `DELETE FROM questions` only. Update replaces the choice set with `DELETE FROM choices WHERE question_id = ?1` then insert (not question-delete cascade) |

**Verification (2026-09-03, this session — local D1, no `--remote`)**:

1. Phase 2 tests: `migrations/questions-schema.test.ts`, `src/lib/mcq-schemas.test.ts`, `src/lib/services/mcq-service.test.ts` — **3 files, 31 passed** (exit 0)
2. Full suite: `npm test` — **18 files, 99 passed** (exit 0)
3. `npm run lint` — exit 0
4. `npx wrangler d1 migrations apply quizmaker --local` — **No migrations to apply** (`0003_create_questions.sql` already on local D1)
5. `PRAGMA table_info(questions)` / `choices` plus `sqlite_master` SQL — TEXT PKs, `owner_id`, `is_correct INTEGER`, `position`, both `ON DELETE CASCADE` FKs
6. `/mcqs` remains the auth-gated stub. No Phase 3 HTTP routes were added in the Phase 2 session.

Phase 2 gate is met.

### Phase 3: MCQ Service Layer (Server Actions) - COMPLETED

**Objective**: Session-gated Server Actions call the existing MCQ service. Add server-side attempt correctness. Keep Client → Server Action → Service → DB. No `/mcqs` UI yet.

**Tests first (expect red)**:
1. `questionAttemptSchema` — trim ids, reject empty, drop client `isCorrect`
2. `checkQuestionAttempt` — scores from stored `1`/`0`, not-found for missing question/choice, validation with no SQL
3. `src/app/mcqs/actions.test.ts` — no session → `McqUnauthorizedError`; create uses session `userId` not body `ownerId`; update/delete pass session owner; attempt action delegates to the service

**Then implement**:
1. `questionAttemptSchema` in `src/lib/mcq-schemas.ts`
2. `checkQuestionAttempt` in `src/lib/services/mcq-service.ts` (reuse `getQuestion`; do not persist attempts)
3. `src/app/mcqs/actions.ts` (`"use server"`) — `requireActor()` via `qm_session` + `getSession`
4. Do not change `src/app/mcqs/page.tsx`

**Phase gate**: `npm test` green. `npm run lint` exit 0. No new migration. No Phase 4 UI.

**Deliverables**:
- `questionAttemptSchema` + tests
- `checkQuestionAttempt` + tests
- `src/app/mcqs/actions.ts` + `src/app/mcqs/actions.test.ts`

**As-built implementation**:

| Item | Location / value |
|------|------------------|
| Layering | Client (Phase 4) → `src/app/mcqs/actions.ts` → `mcq-service` → D1. Actions are the only new production files besides the attempt helper. |
| Actor | `cookies().get("qm_session")` then `getSession(env.DB, sessionId)`. Missing session → `McqUnauthorizedError`. |
| Create/update/delete | `ownerId` is `session.userId`. Body `ownerId` is ignored as the actor. |
| Attempt | `checkQuestionAttempt` loads the question, finds the choice, returns `{ questionId, choiceId, isCorrect }` from mapped D1 `is_correct`. Extra `isCorrect` on the payload is stripped by Zod. |
| Cascade / replace | Unchanged from Phase 2: delete question only; update deletes then re-inserts choices with 0-based `position`. |
| UI | `/mcqs` still the stub. Actions are not wired into the page. |

**Verification (2026-09-03, this session)**:
1. New tests failed first: missing `questionAttemptSchema`, `checkQuestionAttempt is not a function`, `Failed to resolve import "./actions"`
2. After implementation: Phase 3 files green; full `npm test` — **19 files, 111 passed** (exit 0)
3. `npm run lint` — exit 0
4. No D1 migration and no `--remote`
5. `src/app/mcqs/page.tsx` unchanged (still stub)

Phase 3 gate is met.

### Phase 4: Server Actions - COMPLETED

**Objective**: Finish the Client → Server Action → Service → DB boundary. Actions validate with Zod, map ownership and other failures to `{ ok, code, error }`, score attempts on the server, and never touch D1 SQL.

**Tests first (expect red)**:
1. `questionIdSchema` trims and rejects empty ids
2. No session → `{ ok: false, code: "unauthorized" }`; service and `db.prepare` not called
3. Invalid create / ids / attempt → `{ ok: false, code: "validation" }` and service not called
4. Success → `{ ok: true, data }`; create uses session `userId`, not body `ownerId`
5. Missing question → `not_found`; wrong owner → `forbidden`; unexpected throw → `server` / `"Something went wrong"`
6. Attempt result `isCorrect` comes from the service; client `isCorrect` is stripped before the service call

**Then implement**:
1. `questionIdSchema` in `src/lib/mcq-schemas.ts`
2. Rewrite `src/app/mcqs/actions.ts` to return `McqActionResult<T>`, parse with Zod, catch service errors, never `prepare`
3. Keep `src/app/mcqs/page.tsx` as the stub (Phase 5)

**Phase gate**: `npm test` green. `npm run lint` exit 0. No UI. No `--remote`.

**Deliverables**:
- `questionIdSchema` + tests
- Session-gated actions with success/error results
- Updated `src/app/mcqs/actions.test.ts`

**As-built implementation**:

| Item | Location / value |
|------|------------------|
| Result | `{ ok: true, data }` or `{ ok: false, code, error }` with `unauthorized` / `validation` / `not_found` / `forbidden` / `server` |
| Zod | Action parses with `createQuestionSchema` / `updateQuestionSchema` / `questionIdSchema` / `questionAttemptSchema` **before** calling the service |
| Actor | `getSession(env.DB, qm_session)`. Pass `session.userId` as `ownerId`. Unknown `ownerId` on the body is stripped by Zod |
| DB | Actions pass `env.DB` into services only. No `prepare`, no SQL in `actions.ts` |
| Attempt | Parsed `{ questionId, choiceId }` only; `isCorrect` from D1 via `checkQuestionAttempt` |
| UI | `/mcqs` still the stub |

**Verification (2026-09-03, this session)**:
1. New tests failed first (`questionIdSchema` undefined; actions still threw / returned raw questions)
2. `npm test` — **19 files, 118 passed** (exit 0)
3. `npm run lint` — exit 0
4. `src/app/mcqs/page.tsx` unchanged

Phase 4 gate is met.

### Phase 5: Dashboard MCQ list - COMPLETED

**Objective**: Signed-in teachers see the shared question bank as a table, with create navigation, preview, edit navigation, and confirmed delete. Loading, empty, and error states are visible. Layout session gating is unchanged.

**Tests first (expect red)**:
1. `src/components/mcq-dashboard.test.tsx` — loading, empty + `/mcqs/new`, list error, unauthorized → `/login`, table + Edit/Preview/Delete, preview dialog, delete cancel, delete confirm removes row, forbidden keeps row
2. `src/app/mcqs/page.test.tsx` — heading, logout, create link, no question form
3. Existing `layout.test.ts` still proves the server session redirect (auth hydration)

**Then implement**:
1. `src/components/mcq-dashboard.tsx` — client; `listQuestionsAction` / `deleteQuestionAction` only
2. Replace the `/mcqs` stub with dashboard chrome + `McqDashboard`
3. Placeholder `/mcqs/new` and `/mcqs/[id]/edit` so navigation does not 404
4. Do not change `src/app/mcqs/layout.tsx`

**Phase gate**: `npm test` green. `npm run lint` exit 0. No Phase 6 verify/browser pass. No create/edit forms.

**Deliverables**:
- `src/components/mcq-dashboard.tsx` + `src/components/mcq-dashboard.test.tsx`
- Updated `/mcqs` page
- Placeholder create/edit routes

**As-built implementation**:

| Item | Location / value |
|------|------------------|
| Auth | `layout.tsx` still `getSession` + `redirect("/login")`. Dashboard does not add a competing client gate except action `unauthorized` → `/login`. |
| List | `useEffect` loads once via `listQuestionsAction`. `useRouter` is not an effect dependency (avoids refetch wiping a successful delete). |
| Components | shadcn `card`, `table`, `button`, `dialog` (preview badge dialog removed in Phase 7) |
| Delete | Capture target id before `await`; Cancel does not call the action |
| Forms | `/mcqs/new` and `/mcqs/[id]/edit` are placeholders only |

**Verification (2026-09-03, this session)**:
1. New tests failed first (missing `./mcq-dashboard`; no Create question link)
2. `npm test` — **20 files, 127 passed** (exit 0)
3. `npm run lint` — exit 0
4. `src/app/mcqs/layout.tsx` unchanged

Phase 5 gate is met. Create/edit forms shipped in Phase 6.

### Phase 6: Create/Edit MCQ forms - COMPLETED

**Objective**: Replace placeholder `/mcqs/new` and `/mcqs/[id]/edit` with working forms. Teachers enter a stem (labeled “Question”), two to six choices, and exactly one correct answer. Save uses Server Actions; Cancel returns to the bank. Schema has stem + choices only — no description column.

**Tests first (expect red)**:
1. `src/components/mcq-question-form.test.tsx` — create fields, empty stem, add/remove 2–6 choices, save via `createQuestionAction`, Cancel does not save, server error stays, unauthorized save → `/login`
2. Edit: loading, prefill + `updateQuestionAction`, load error, unauthorized load → `/login`
3. `src/app/mcqs/new/page.test.tsx` and `src/app/mcqs/[id]/edit/page.test.tsx` — headings and form chrome

**Then implement**:
1. `src/components/mcq-question-form.tsx` — client; actions only; no `mcq-service`
2. Replace placeholder pages at `/mcqs/new` and `/mcqs/[id]/edit`
3. Do not change `src/app/mcqs/layout.tsx`
4. Do not add a description column or `/api/questions`

**Phase gate**: `npm test` green. `npm run lint` exit 0. No Phase 7 verify/browser pass.

**Deliverables**:
- `src/components/mcq-question-form.tsx` + tests
- Create and edit pages (no longer placeholders)

**As-built implementation**:

| Item | Location / value |
|------|------------------|
| Auth | Layout session gate unchanged. Form `unauthorized` → `/login`. |
| Stem | Labeled “Question”; FieldDescription “The prompt teachers will see.” Matches `stem` in Zod/D1. |
| Choices | Start at 2; Add up to 6; Remove down to 2. Radios mark exactly one correct. Removing the correct choice marks the first remaining. |
| Create | `createQuestionAction({ stem, choices })` then `router.push("/mcqs")` |
| Edit | `getQuestionAction(id)` then `updateQuestionAction(id, { stem, choices })` |
| Cancel | Link to `/mcqs`; does not call an action |
| Components | shadcn `card`, `field`, `input`, `button` |
| Errors | Client validation before the action; `FieldError` for action `error` strings |

**Verification (2026-09-03, this session)**:
1. New tests failed first (missing `./mcq-question-form`)
2. `npm test` — **23 files, 140 passed** (exit 0)
3. `npm run lint` — exit 0
4. `src/app/mcqs/layout.tsx` unchanged
5. No new migration and no `--remote`

Phase 6 gate is met. Preview/attempt UI shipped in Phase 7.

### Phase 7: Preview & Attempts - COMPLETED

**Objective**: Teachers can preview a question by answering it. The page shows the stem and choices, accepts one answer, records the attempt through `checkQuestionAttemptAction`, and shows Correct/Incorrect from D1. Try again and Back are available. Loading and error states are visible. The client never decides correctness.

**Tests first (expect red)**:
1. `src/components/mcq-attempt.test.tsx` — loading, no Correct leak, require a choice, action called with `{ questionId, choiceId }` only, feedback follows the server even when loaded `isCorrect` disagrees, Try again, server error stays, load error, unauthorized load/check → `/login`
2. `src/app/mcqs/[id]/preview/page.test.tsx` — heading, form, Back
3. Dashboard Preview is a link to `/mcqs/[id]/preview`, not a reveal dialog

**Then implement**:
1. `src/components/mcq-attempt.tsx` — client; `getQuestionAction` + `checkQuestionAttemptAction`; strip `isCorrect` from displayed choices
2. `/mcqs/[id]/preview` page
3. Dashboard Preview → link; remove the badge dialog
4. Do not change `src/app/mcqs/layout.tsx`
5. Do not add an attempts table or `/api/questions`

**Phase gate**: `npm test` green. `npm run lint` exit 0. No Phase 8 verify/browser pass.

**Deliverables**:
- `src/components/mcq-attempt.tsx` + tests
- Preview/attempt page
- Dashboard Preview navigation

**As-built implementation**:

| Item | Location / value |
|------|------------------|
| Auth | Layout session gate unchanged. Attempt `unauthorized` → `/login`. |
| Load | `getQuestionAction(id)`. Display `{ stem, choices: [{ id, label }] }` only. |
| Record | `checkQuestionAttemptAction({ questionId, choiceId })`. Payload has no `isCorrect`. |
| Feedback | UI uses `result.data.isCorrect` only. Loaded choice flags are ignored. |
| Try again | Clears selected choice and recorded result; Check answer returns. |
| Back | Link to `/mcqs` |
| Persistence | No attempts table. The recorded result lives in component state until Try again. |
| Components | shadcn `card`, `field`, `button` |

**Verification (2026-09-04, this session)**:
1. New tests failed first (missing `./mcq-attempt` and `./page`; Preview still a button)
2. `npm test` — **25 files, 151 passed** (exit 0)
3. `npm run lint` — exit 0
4. `src/app/mcqs/layout.tsx` unchanged
5. No new migration and no `--remote`

Phase 7 gate is met. Quality/docs/verify shipped in Phase 8.

### Phase 8: Quality, Documentation & Final Verification - COMPLETED

**Objective**: Review the MCQ feature against this PRD, run the full suite plus lint and production build, walk the signed-in user flow, fix accessibility and documentation gaps, and record as-built status.

**Checks**:
1. PRD vs code: Server Actions, no `/api/questions`, layout session gate, Zod-then-service, no client `isCorrect` for grading, no attempts table
2. `npm test`, `npm run lint`, `npm run build`
3. HTTP path through local `next dev` (Cloudflare bindings via `initOpenNextCloudflareForDev`): unauthenticated `/mcqs*` → `/login`; register; signed-in dashboard/create/edit/preview pages
4. Accessibility: unique row action names, delete dialog names the stem, attempt radios in a fieldset, loading `role="status"`

**Phase gate**: Tests green, lint exit 0, build compiles, unauthenticated MCQ routes redirect, signed-in pages render.

**As-built verification (2026-09-04, this session)**:

| Check | Result |
|-------|--------|
| `npm test` | **25 files, 151 passed** (exit 0) |
| `npm run lint` | exit 0 |
| `npm run build` | Compiled; TS ok. Routes: `/mcqs`, `/mcqs/new`, `/mcqs/[id]/edit`, `/mcqs/[id]/preview` (dynamic) |
| Unauthenticated `/mcqs`, `/mcqs/new`, `/mcqs/[id]/edit`, `/mcqs/[id]/preview` | HTTP 307 → `/login` |
| `POST /api/register` | 201 + `qm_session` |
| Signed-in `/mcqs` | 200 — Question bank, Create question, Log out |
| Signed-in `/mcqs/new` | 200 — Create question, Save question, Cancel |
| Signed-in `/mcqs/missing-id/preview` | 200 — Preview question (client then shows not-found) |
| Signed-in `/mcqs/missing-id/edit` | 200 — Edit question (client then shows not-found) |
| `POST /api/login` | 200 + `qm_session` |
| Layout | `src/app/mcqs/layout.tsx` still `getSession` + `redirect("/login")` |
| Actions | No `db.prepare` / SQL; no `'use client'` import of `mcq-service` |
| Browser MCP | Not available; HTTP + Vitest used instead of a headed browser |

No new migration. No `--remote`. No deploy.

Phase 8 gate is met. The MCQ CRUD feature is complete.

---

## Technical Implementation Details

### Key Files

| Path | Role |
|------|------|
| `migrations/0003_create_questions.sql` | `questions` + `choices` with CASCADE |
| `migrations/questions-schema.test.ts` | Schema shape, ownership FK, cascade, indexes |
| `src/lib/mcq-schemas.ts` | Zod `createQuestionSchema` / `updateQuestionSchema` / `questionAttemptSchema` / `questionIdSchema` |
| `src/lib/services/mcq-service.ts` | `createQuestion`, `getQuestion`, `listQuestions`, `updateQuestion`, `deleteQuestion`, `checkQuestionAttempt` |
| `src/app/mcqs/actions.ts` | Session-gated Server Actions; Zod then service; `{ ok, data \| code, error }` |
| `src/components/mcq-dashboard.tsx` | List table, delete confirm, create/edit/preview links with unique action labels |
| `src/components/mcq-question-form.tsx` | Create/edit form: stem, 2–6 choices, one correct, Save/Cancel |
| `src/components/mcq-attempt.tsx` | Preview/attempt: choose a choice, server-scored feedback, Try again |
| `src/app/mcqs/new/page.tsx` | Create question page |
| `src/app/mcqs/[id]/edit/page.tsx` | Edit question page (loads by id) |
| `src/app/mcqs/[id]/preview/page.tsx` | Preview/attempt page |
| `src/app/mcqs/page.tsx` | Question-bank chrome + `McqDashboard` + logout |
| `src/app/mcqs/layout.tsx` | Session gate (unchanged) |

### Service names (shipped)

```typescript
export class McqValidationError extends Error {}
export class McqNotFoundError extends Error {}
export class McqForbiddenError extends Error {}

createQuestion(db, ownerId, input) // ownerId from session, never from body
getQuestion(db, id)                // shared read; null if missing
listQuestions(db)                  // all questions, choices ordered
updateQuestion(db, id, ownerId, input)
deleteQuestion(db, id, ownerId)    // DELETE questions only; CASCADE drops choices
checkQuestionAttempt(db, input)    // { questionId, choiceId } → { …, isCorrect } from D1
```

Server Actions (`src/app/mcqs/actions.ts`) return `McqActionResult<T>`. They validate with Zod, then call the service. They do not throw `McqUnauthorizedError` to the client; missing session is `{ ok: false, code: "unauthorized" }`. They do not run SQL.

- Email/username hashing is unchanged. This module must not be imported from `'use client'`.
- Reads use `all()` and `results[0]`, not `first()`.
- Update replaces the choice set: `DELETE FROM choices WHERE question_id = ?1` then insert. That is not question-delete cascade.
- `listQuestions` does not filter by owner (shared bank).

### Boolean and order helpers

```typescript
function toSqliteBool(value: boolean): 0 | 1 {
	return value ? 1 : 0;
}

function fromSqliteBool(value: number): boolean {
	return Number(value) === 1;
}
```

Choice `position` is the 0-based index of the submitted array.

### Important Notes

- Ask before new dependencies. Zod is already installed.
- Never apply this migration `--remote` unless the user asks.
- Do not add JWT. `/mcqs` still uses `qm_session`.
- Do not add `/api/questions` unless the user asks; Server Actions are the MCQ boundary.

---

## Acceptance Criteria

- [x] `questions` and `choices` exist in local D1 with TEXT ids
- [x] Queries use numbered placeholders
- [x] Only the owner can update or delete a question
- [x] Missing id → `McqNotFoundError`; wrong owner → `McqForbiddenError`
- [x] Invalid payload → `McqValidationError` and no SQL
- [x] Choices return in `position` order
- [x] `isCorrect` is boolean in the service; D1 stores 0/1
- [x] Deleting a question does not issue `DELETE FROM choices` (CASCADE)
- [x] `npm test` green — **25 files, 151 passed** (2026-09-04)
- [x] `npm run lint` exit 0
- [x] Session-gated Server Actions call the service (Phase 3)
- [x] Attempt correctness is decided from D1 `is_correct`, not a client flag
- [x] Actions return `{ ok: true, data }` or `{ ok: false, code, error }` (Phase 4)
- [x] Actions validate with Zod before the service and do not run SQL
- [x] `/mcqs` dashboard lists questions with loading/empty/error, preview, delete confirm, create/edit navigation (Phase 5)
- [x] Create/edit forms: 2–6 choices, exactly one correct, Save/Cancel, action errors (Phase 6)
- [x] Preview/attempt: server-scored Correct/Incorrect, Try again, Back, loading/error (Phase 7)
- [x] Phase 8 verify: `npm test`, `npm run lint`, `npm run build`, signed-in HTTP flow, PRD matches as-built

---

## Success Metrics

| Metric | Target | Result |
|--------|--------|--------|
| Phase 2 tests prove data-access rules | All new tests fail then pass | 31 Phase 2 tests passed after implementation |
| Phase 3 tests prove actions + attempts | Fail then pass | New tests failed (missing exports/module), then 111/111 |
| Phase 4 tests prove action results | Fail then pass | 13 new tests failed (throws / raw payloads), then 118/118 |
| Phase 5 dashboard list | Fail then pass | Missing module / create link, then 127/127 |
| Phase 6 create/edit forms | Fail then pass | Missing `./mcq-question-form`, then 140/140 |
| Phase 7 preview/attempt | Fail then pass | Missing `./mcq-attempt` / preview page; Preview still a button; then 151/151 |
| Phase 8 quality + verify | Suite, lint, build, HTTP flow | 151/151; lint 0; Next.js compile; unauth 307 /login; signed-in pages 200 |
| Suite stays green | `npm test` exit 0 | 151/151 passed |
| Lint clean | `npm run lint` exit 0 | exit 0 |
| Production build | `npm run build` exit 0 | Compiled successfully |

---

## Dependencies

### External Dependencies

- Cloudflare D1 — persist questions and choices

### Internal Dependencies

- Existing `users` table (`owner_id` FK)
- Zod v4
- `.cursor/skills/testing/SKILL.md`
- `.cursor/rules/d1.mdc` — numbered placeholders, `all()` not `first()`

### Environment

- Local apply only: `npx wrangler d1 migrations apply quizmaker --local`
- Production will not get `questions` / `choices` until the user applies `--remote`

---

## Risks and Mitigation

### Technical Risks

- **Risk**: Anonymous `?` placeholders break local Wrangler.
- **Mitigation**: Numbered `?1`, `?2` only; SQL-safety test rejects concatenation.

- **Risk**: Binding JS booleans stores values D1 cannot compare consistently.
- **Mitigation**: `toSqliteBool` / `fromSqliteBool` (0 and 1 only).

- **Risk**: Deleting choices in `deleteQuestion` would duplicate CASCADE and hide a missing FK.
- **Mitigation**: Service deletes the question row only.

- **Risk**: A teacher could send `ownerId` in the JSON body.
- **Mitigation**: Service takes `ownerId` as a separate argument from the session. Body never sets owner.

### User Experience Risks

- **Risk**: Teachers expect to hide other teachers’ questions.
- **Mitigation**: Shared bank is intentional. Writes are still owner-only. Change only if a later PRD says so.

---

## Troubleshooting Guide

### Unique position constraint on update

**Problem**: Updating a question fails with `UNIQUE constraint failed: choices.question_id, position`.
**Cause**: New choices were inserted before the old rows were deleted.
**Solution**: `DELETE FROM choices WHERE question_id = ?1` first, then insert.
**Code Reference**: `src/lib/services/mcq-service.ts`

### Forbidden looks like not found

**Problem**: Editing someone else’s question returns 404 in a later HTTP phase.
**Cause**: Mapping both `McqForbiddenError` and `McqNotFoundError` to 404.
**Solution**: Keep the typed errors distinct in the service. HTTP can choose 403 vs 404 later.
**Code Reference**: `src/lib/services/mcq-service.ts`

---

## Notes for AI Agents

1. Phases 1–8 are **done**. The MCQ feature is shipped. Do not rewrite the service, migration, Server Actions, dashboard, create/edit forms, or preview/attempt unless a test fails.
2. Keep calling `*Action` from `src/app/mcqs/actions.ts` and branch on `result.ok`. Do not import `mcq-service` into `'use client'` files.
3. Get the actor from `getSession` + `qm_session`. Pass `session.userId` as `ownerId`. Never trust `ownerId` from the client body.
4. Grade attempts with `checkQuestionAttemptAction`. Do not trust a client `isCorrect`.
5. TDD with existing Vitest. Do not reinstall the harness.
6. Never apply D1 migrations remotely and never deploy unless asked.
7. Server Actions must not call `db.prepare` or write SQL.
8. Do not change `src/app/mcqs/layout.tsx` session gating unless fixing a real auth bug.

---

## Current Status

**Last Updated**: 2026-09-04
**Current Phase**: Phase 8 complete. MCQ CRUD is **shipped**.
**Status**: Phase 8 COMPLETED — tests, lint, production build, and signed-in HTTP flow. Accessibility: unique Edit/Preview/Delete names, delete dialog includes the stem, attempt choices in a fieldset, loading `role="status"`. PRD matches as-built. Layout session gate unchanged.
**Git**: Branch `feature/register-login-logout`.
**Verification (2026-09-04, this session)**:
- `npm test` — **25 files / 151 passed**
- `npm run lint` — exit 0
- `npm run build` — compiled; `/mcqs`, `/mcqs/new`, `/mcqs/[id]/edit`, `/mcqs/[id]/preview` present
- HTTP: unauthenticated MCQ routes 307 → `/login`; register 201; signed-in dashboard/create/edit/preview 200
**Next Steps**: None for this PRD. Do not deploy or apply D1 `--remote` unless asked.
