# FurCircle Phase 9 — Task List
# Provider split + Email (SES). Plan: tasks/plan-phase9-provider-split-notifications.md

## Pre-build decisions
- [ ] **DECIDE** From-address for SES (e.g. no-reply@furcircle.app) + dev verified recipients
- [ ] **DECIDE** SES production access vs sandbox for launch
- [x] **DECIDED** Owner phone → **email-only** behaviourist handoff (no phone field)
- [ ] **DECIDE** nutritionist — coming-soon vs remove (default: coming-soon)

> Ship order: **S0 → S1 first** (locked 2026-06-06), then S2→S4.

---

## S0 — SES email channel  ⟶ blocks S1, S3  ✅ DONE (commit 16e607b)
- [x] `src/lib/email.ts` — `sendEmail({to,subject,html,text})` via `@aws-sdk/client-sesv2`
- [x] `src/functions/notifications/sendProviderEmail.ts` — SNS consumer, switch on Subject
- [x] `serverless.yml` — fn def (sns event), `ses:SendEmail` IAM, `FROM_EMAIL` env, SES identity
- [x] Unit test: `email.ts` (SES mocked) + `sendProviderEmail` routing
- [x] ✅ failure non-fatal (consumer try/catch); 452 tests green, tsc clean
- [ ] **CHECKPOINT A (deploy-time, deferred)** — verify from-address in SES, sandbox vs prod access, dev verified recipients. Not code-blocking.

## S1 — Behaviourist email handoff  ✅ DONE (commit a8de48d)
- [x] `submitAssessment.ts` — status terminal `submitted`; drop approve/reject fields
- [x] `submitAssessment.ts` — 409 guard → 24h anti-spam
- [x] `submitAssessment.ts` — SNS payload carries owner+pet+concern (subject `behaviourist_intake`)
- [x] `sendProviderEmail.ts` — handle `behaviourist_intake` (fetch owner/dog/behaviourist, compose)
- [x] Update `tests/functions/assessments/submitAssessment.test.ts`
- [x] ✅ 201 `submitted`, behaviourist emailed, no approval path; 457 green, tsc clean
- [ ] **CHECKPOINT B** — S0+S1 deliver behaviourist email handoff. Review before S2/S3.

## S2 — Provider taxonomy (veterinarian + behaviourist)  ✅ DONE (commit b65dcec)
- [x] Adopt `providerType:'veterinarian'`
- [x] `listProviders.ts` — add `veterinarian`; decouple vet path from booking/assessment
- [x] Backfill script `scripts/backfill-vet-gsi3.ts` (dry-run by default; run `--apply` at deploy)
- [x] Update `tests/functions/providers/listProviders.test.ts` (veterinarian case)
- [x] ✅ vets list by rating; behaviourist unchanged; bad type 400; 459 green, tsc clean
- [ ] **DEPLOY-TIME** run backfill `--apply` once veterinarians are admin-added (dev currently has none)

## S3 — Ask-a-Vet broadcast  ✅ DONE (commits 5234736, 1d01a31)
- [x] `createThread.ts` — drop required vetId; write unassigned thread (`vetId:null`, `status:'unassigned'`, `GSI2PK=QUEUE#ask_a_vet`)
- [x] Broadcast alert: on `question_broadcast`, query all active vets → push + email each
- [x] Claim-on-reply: conditional update in `vetSendMessage.ts` (cond `status='unassigned'`) → 409 `ALREADY_CLAIMED`
- [x] `vetListThreads.ts` — surface shared `QUEUE#ask_a_vet` open items + claimed threads
- [x] Preserve welcome-plan 1/month gate
- [x] Tests: createThread, vetSendMessage (claim race), vetListThreads, providers helper, both consumers
- [x] ✅ 469 green, tsc clean, sls config resolves
- [ ] **CHECKPOINT D** — ⚠️ BREAKING API CHANGE: `POST /threads` no longer takes `vetId`. Mobile client must update. Deploy needs OpenAPI sync (S4) + client coordination.

## S4 — Cleanup + docs
- [ ] `nutritionist` → coming-soon in listProviders/home
- [ ] Test asserting behaviourist no longer routes to bookings
- [ ] Update `docs/openapi.yaml`
- [ ] Update `docs/founder-homescreen-services-analysis.md` (done log)
- [ ] ADR `docs/adr-ask-a-vet-broadcast.md`
- [ ] ✅ OpenAPI matches handlers; suite green (minus live-AWS integration test)
