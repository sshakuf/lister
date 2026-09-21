# Google Login Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace manually copied browser tokens with owner-only Google login while retaining offline edits and local recovery.
**Architecture:** Local Google configuration and a dedicated persistent session store integrate with existing hive auth; web login offers Google and recovery access.
**Tech Stack:** TypeScript, Fastify, React, Node SQLite, maintained Google/OIDC verification library.
**Spec:** docs/superpowers/specs/2026-09-21-google-login-design.md

## Global constraints
- Owner sshakuf@gmail.com for deployed instance; configurable for other users.
- Node >=22.13.0; secrets never committed or included in hive export.
- Never discard IndexedDB, pending edits, existing IDs or computer credentials.

## Task 1: Authentication and browser integration
- [ ] Add failing tests for Google config, login state, owner binding, durable cookie sessions, expiry/revocation, CSRF and bearer compatibility in packages/server/test/google-auth.test.ts. Run targeted test and record expected missing-feature failure.
- [ ] Implement isolated Google auth modules in packages/server/src/auth and wire into app.ts/server.ts and hive/routes.ts. Use a maintained verification library. Public callback URI is fixed, never built from untrusted Host or forwarded headers. Request only openid/email. Persist subject binding and hashed sessions outside hive database/export.
- [ ] Update packages/web/src/components/HivePanel.tsx and hive/http.ts to offer Google login and browser session management without removing offline data. Add regression coverage for token/cookie compatibility and offline reauthentication.
- [ ] Run targeted tests, full pnpm test and pnpm build. Commit only explicit source/dependency/test paths.
- [ ] Independent security and spec review; fix important findings and rerun affected tests.

## Task 2: Setup and verification
- [ ] Document exact Google Auth Platform fields and callback URL in README; prepare local example config with no secrets.
- [ ] Ask for OAuth client setup, keeping secret out of chat; no actual Google login claim until verified.
- [ ] Record outcomes in project outline (never commit .lister).
- [ ] Integrate completed tested change for user deployment, clearly report remaining credential/iPhone verification work.
