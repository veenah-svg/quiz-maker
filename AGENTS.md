# AGENTS.md

Instructions for AI agents working in this repository. This file is loaded into every
agent conversation, so it describes only what is stable and true of the project.

## Project

Quiz Maker is a shared test bank of multiple-choice questions for several teachers.
Register, login, and logout are shipped: accounts live in D1, passwords are SHA-256
hashed in the browser, and successful auth sets an HttpOnly `qm_session` cookie backed
by a D1 `sessions` row. `/mcqs` requires a valid session for that browser. Logout
deletes **only** that cookie’s session, so other browsers stay signed in. A new
browser has no cookie and must log in again.

The as-built auth contract is `ai-workspace/register-login-logout_prd.md`. Do not
re-implement that feature. MCQ persistence is in `src/lib/services/mcq-service.ts`
(`ai-workspace/mcq-crud_prd.md` Phase 2). `/mcqs` is still a stub until HTTP/UI phases.

## Stack

- **Next.js 16** with the App Router and React 19
- **Cloudflare Workers** for hosting, via `@opennextjs/cloudflare`
- **Cloudflare D1** bound as `DB` (database name `quizmaker`)
- **Tailwind CSS v4**, configured in CSS rather than a JS config file
- **shadcn/ui** on Base UI, `base-nova` style, with Lucide icons
- **TypeScript** in strict mode
- **Wrangler** for Cloudflare configuration, secrets, and deployment
- **Vitest** (jsdom) for unit tests
- **Zod** v4 for route-handler body validation

No authentication library, testing pool for Workers, or AI SDK is
installed. Sessions are a D1 table plus an HttpOnly cookie — do not add JWT, OAuth,
or a session package without asking. Do not write code that imports a new library
without adding it first and telling the user.

## Layout

```
src/app/            Routes, layouts, and global styles (App Router)
src/app/api/        HTTP route handlers (register, login, logout)
src/components/     Feature UI (login-form, signup-form, logout-button)
src/components/ui/  shadcn/ui components (generated; avoid hand-editing)
src/lib/            Shared utilities (`password.ts`, `auth-schemas.ts`, `mcq-schemas.ts`, `http.ts`, `session-cookie.ts`)
src/lib/services/   Domain logic (`user-service.ts`, `session-service.ts`, `mcq-service.ts`) — server-only, no `'use client'`
migrations/         D1 SQL migrations
ai-workspace/       Technical PRDs and planning documents
.cursor/rules/      File-scoped conventions (including auth.mdc)
.cursor/skills/     Task-specific guidance loaded on demand
public/             Static assets
```

Import through the `@/` alias, which maps to `src/`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server on Node at `localhost:3000` |
| `npm run preview` | Build and run on the local **Workers** runtime |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest once (`vitest run`) |
| `npm test:watch` | Vitest watch |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run cf-typegen` | Regenerate `cloudflare-env.d.ts` after changing bindings |

`npm run dev` runs on Node and will not surface Workers-specific problems. Verify
anything runtime-sensitive with `npm run preview`. On PowerShell, chain commands
with `;`, not `&&`.

## Working agreements

- **Do not deploy.** Never run `npm run deploy` unless explicitly asked.
- **Do not touch the remote database.** Migrations may be applied locally only.
- **Ask before adding a dependency.** This is a teaching repository; an unexplained
  dependency is a cost. Propose it and say why. D1, Vitest, and Zod are already in
  the stack.
- **Do not edit generated files.** `cloudflare-env.d.ts`, `next-env.d.ts`, and
  `package-lock.json` are generated.
- **Keep secrets out of the repo.** Local values belong in `.dev.vars`, which is
  gitignored. When adding a variable, also add an empty placeholder to
  `.dev.vars.example`. Production values go in `wrangler secret put`.
- **Verify before claiming completion.** Run `npm run lint` and `npm run build` and
  report the actual result. Do not describe work as done based on inspection alone.
  For behavior changes also run `npm test`.
- **Say when you are unsure.** A flagged uncertainty is more useful than a confident
  guess that has to be unwound later.

## Cursor Cloud specific instructions

Cloud agents have no Cloudflare credentials and no `.dev.vars`. In that environment:

- `npm run dev`, `npm run build`, `npm run lint`, and `npm test` work normally.
- `npm run preview`, `npm run deploy`, and any `wrangler` command that needs
  authentication will fail. This is expected. Do not try to authenticate.
- If a task genuinely requires Cloudflare access, stop and report that it must be run
  locally instead.
