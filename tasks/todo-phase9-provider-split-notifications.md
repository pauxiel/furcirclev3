# FurCircle Phase 9 — Task List
# Provider split + Email (SES). Plan: tasks/plan-phase9-provider-split-notifications.md

## Pre-build decisions
- [ ] **DECIDE** From-address for SES (e.g. no-reply@furcircle.app) + dev verified recipients
- [ ] **DECIDE** SES production access vs sandbox for launch
- [x] **DECIDED** Owner phone → **email-only** behaviourist handoff (no phone field)
- [ ] **DECIDE** nutritionist — coming-soon vs remove (default: coming-soon)

> Ship order: **S0 → S1 first** (locked 2026-06-06), then S2→S4.

---

## S0 — SES email channel  ⟶ blocks S1, S3
- [ ] `src/lib/email.ts` — `sendEmail({to,subject,html,text})` via `@aws-sdk/client-sesv2`
- [ ] `src/functions/notifications/sendProviderEmail.ts` — SNS consumer, switch on Subject
- [ ] `serverless.yml` — fn def (sns event), `ses:SendEmail` IAM, `FROM_EMAIL` env, SES identity
- [ ] Unit test: `email.ts` (SES mocked) + `sendProviderEmail` routing
- [ ] `events/providerEmail.json` + `sls invoke local`
- [ ] ✅ Email arrives in dev; failure non-fatal
- [ ] **CHECKPOINT A** — review from-address / SES access / phone decision

## S1 — Behaviourist email handoff  (independent; can ship first)
- [ ] `submitAssessment.ts` — status terminal `submitted`; drop approve/reject fields
- [ ] `submitAssessment.ts` — replace 409 guard with anti-spam or remove
- [ ] `submitAssessment.ts` — SNS payload carries owner+pet+concern (subject `behaviourist_intake`)
- [ ] `sendProviderEmail.ts` — handle `behaviourist_intake` (fetch owner/dog/behaviourist, compose)
- [ ] Update `tests/functions/assessments/submitAssessment.test.ts`
- [ ] `sls invoke local -f submitAssessment` → email received
- [ ] ✅ 201 `submitted`, behaviourist emailed, no approval path
- [ ] **CHECKPOINT B**

## S2 — Provider taxonomy (veterinarian + behaviourist)  ⟶ blocks S3
- [ ] Adopt `providerType:'veterinarian'`; ensure vet `VET#` profiles carry GSI3 keys
- [ ] `listProviders.ts` — add `veterinarian`; decouple vet path from booking/assessment
- [ ] Backfill script/doc — tag existing vet records with GSI3 keys
- [ ] Update `tests/functions/providers/listProviders.test.ts` (veterinarian case)
- [ ] `sls invoke local -f listProviders` type=veterinarian
- [ ] ✅ vets list by rating; behaviourist unchanged; bad type 400
- [ ] **CHECKPOINT C** — approve broadcast data model

## S3 — Ask-a-Vet broadcast  (riskiest)
- [ ] `createThread.ts` — drop required vetId; write unassigned thread (`vetId:null`, `status:'unassigned'`, `GSI2PK=QUEUE#ask_a_vet`)
- [ ] Broadcast alert: on `question_broadcast`, query all active vets → push + email each
- [ ] Claim-on-reply: conditional update in `vetSendMessage.ts` (cond on `vetId` null) → 409 `ALREADY_CLAIMED`
- [ ] `vetListThreads.ts` — surface shared `QUEUE#ask_a_vet` open items + claimed threads
- [ ] Preserve welcome-plan 1/month gate
- [ ] Tests: createThread, vetSendMessage (claim race), vetListThreads
- [ ] `sls invoke local` 2-vet simulation
- [ ] ✅ both vets alerted; A claims; B→409; owner sees reply; 2nd/month→403
- [ ] **CHECKPOINT D** — review messaging regressions

## S4 — Cleanup + docs
- [ ] `nutritionist` → coming-soon in listProviders/home
- [ ] Test asserting behaviourist no longer routes to bookings
- [ ] Update `docs/openapi.yaml`
- [ ] Update `docs/founder-homescreen-services-analysis.md` (done log)
- [ ] ADR `docs/adr-ask-a-vet-broadcast.md`
- [ ] ✅ OpenAPI matches handlers; suite green (minus live-AWS integration test)
