Date created: 2026-09-03
Date last modified: 2026-09-03

# MCQ CRUD - Technical PRD

## Overview/Problem

Quiz Maker already lets teachers register, sign in, and reach `/mcqs`, but that page is still a stub. The product’s purpose is a shared test bank of multiple-choice questions. This feature persists questions and their choices in Cloudflare D1, validates create/update payloads, and enforces that only the owning teacher can change or delete a question. HTTP routes and the `/mcqs` UI come in later phases.

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
- Vitest tests written first for this phase

### Out of Scope (later phases)

- HTTP route handlers for questions
- `/mcqs` create/edit/list UI
- Taking quizzes, scoring, or attempt history
- Sharing controls beyond “any signed-in teacher can read the bank”
- Tags, subjects, images, or rich text

### Cut

- Soft delete — hard delete plus CASCADE is enough
- Editing a single choice in isolation — updates replace the choice set
- Listing only “my questions” — the bank is shared; ownership gates writes, not reads
- `@cloudflare/vitest-pool-workers` — unit tests mock D1

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

Phase 2 has no HTTP routes. Later phases will add `/api/questions` using this service.

### User Interface Requirements

Phase 2 has no UI change. `/mcqs` remains the auth-gated stub until a later phase.

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
6. `/mcqs` remains the auth-gated stub. No Phase 3 HTTP routes were added in this session.

Phase 2 gate is met. Phase 3 was not started in this session.

### Phase 3: HTTP endpoints - PLANNED

**Objective**: Session-gated JSON routes call the MCQ service.

### Phase 4: `/mcqs` UI - PLANNED

**Objective**: Signed-in teachers can list, create, edit, and delete questions in the browser.

### Phase 5: Verify - PLANNED

**Objective**: Lint, build, and a browser path through CRUD.

---

## Technical Implementation Details

### Key Files

| Path | Role |
|------|------|
| `migrations/0003_create_questions.sql` | `questions` + `choices` with CASCADE |
| `migrations/questions-schema.test.ts` | Schema shape, ownership FK, cascade, indexes |
| `src/lib/mcq-schemas.ts` | Zod `createQuestionSchema` / `updateQuestionSchema` |
| `src/lib/services/mcq-service.ts` | `createQuestion`, `getQuestion`, `listQuestions`, `updateQuestion`, `deleteQuestion` |

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
```

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
- Do not start Phase 3 until asked.

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
- [x] `npm test` green — **18 files, 99 passed** (2026-09-03)
- [x] `npm run lint` exit 0
- [ ] HTTP CRUD (Phase 3)
- [ ] `/mcqs` UI (Phase 4)

---

## Success Metrics

| Metric | Target | Result |
|--------|--------|--------|
| Phase 2 tests prove data-access rules | All new tests fail then pass | 31 Phase 2 tests passed after implementation |
| Suite stays green | `npm test` exit 0 | 99/99 passed |
| Lint clean | `npm run lint` exit 0 | exit 0 |

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

1. Phase 2 is **done**. Do not rewrite the service or migration unless a test fails.
2. Next phase is HTTP, not more SQL. Reuse `createQuestion` / `getQuestion` / `listQuestions` / `updateQuestion` / `deleteQuestion`.
3. Get the actor from `getSession` + `qm_session`. Pass `session.userId` as `ownerId`. Never trust `ownerId` from the client body.
4. Do not import `mcq-service` into `'use client'` files.
5. TDD with existing Vitest. Do not reinstall the harness.
6. Never apply D1 migrations remotely and never deploy unless asked.

---

## Current Status

**Last Updated**: 2026-09-03
**Current Phase**: Phase 2 complete (re-verified this session). Phase 3 HTTP is **not** started.
**Status**: Phase 2 COMPLETED — Zod validation, `mcq-service` CRUD, numbered placeholders, ownership, choice order, 0/1 boolean mapping, CASCADE on question delete. Schema shipped in `0003_create_questions.sql` (Phase 1 delivered with Phase 2).
**Git**: Branch `feature/register-login-logout`. Implementation landed in `0dea9f4`. This session records re-verification only.
**Verification (2026-09-03, this session)**:
- Phase 2 tests: **31/31 passed** (schema + Zod + service)
- Full suite: `npm test` — **18 files / 99 passed**
- `npm run lint` — exit 0
- Local D1: migrations already applied (`--local` only); `questions` and `choices` match the PRD schema including CASCADE
**Next Steps**: Phase 3 HTTP endpoints when asked. Do not start UI yet. Production will not get these tables until the user applies `0003_create_questions.sql` remotely.
