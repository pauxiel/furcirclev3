# FurCircle — Phase 9 Plan
# Provider split (Veterinarian vs Behaviourist) + Email channel (SES)

## Source decisions (locked 2026-06-06)
- **Channel:** Email (SES) for provider-facing alerts + keep existing Expo push. SMS deferred.
- **Vet flow:** Ask-a-Vet **broadcast** — owner question reaches ALL active vets; any vet answers; first to reply claims the thread.
- **Behaviourist flow:** owner submits intake → behaviourist receives **email** with owner details → follows up **off-platform**. No approve/reject, no in-app booking, no video, no credits.
- **Onboarding:** providers **admin-added** (no self sign-up to build).

## Reference
- `docs/founder-homescreen-services-analysis.md` (founder workflow + prior Option-A decisions)
- `docs/dynamodb-table-design.md` (GSI patterns)
- `docs/spec-phase3-messaging.md`, `docs/spec-phase5-vet-api.md`, `docs/spec-phase7-notifications.md`

## Current-state facts (verified in code)
- One alert channel: Expo push via SNS fan-out — `NotificationsTopic` → `src/functions/notifications/sendPushNotification.ts` → `src/lib/push.ts`. No SES anywhere.
- Providers tagged by `providerType` + GSI3 `PROVIDER_TYPE#{type}` (`RATING#…#VET#…` sort). Today: `behaviourist`, `nutritionist`. Owner list = `listProviders.ts` (rejects anything but those two).
- Vets stored as `VET#{vetId}/PROFILE` (`pushToken`, `isActive`). Not currently exposed through `listProviders`.
- Ask-a-Vet `createThread.ts`: owner picks **one** `vetId` → `THREAD#{id}/METADATA` (`vetId`, GSI2PK=`VET#{vetId}`). Welcome-plan gate = 1 thread/month.
- Behaviourist `submitAssessment.ts`: approve/reject lifecycle (`pending`→`approved`/`rejected`), 409 active-guard, `providerType:'behaviourist'`, SNS ids-only. Booking branch (`createBooking.ts:53`) already dormant (Proactive hidden).

---

## Dependency graph

```
[S0] SES email channel (lib + infra + IAM)
        │
        ├──────────────────────────────┐
        ▼                              ▼
[S1] Behaviourist email handoff   [S2] Provider taxonomy
   (terminal submitted, drop          (tag vets as `veterinarian`,
    approve/reject + booking)          GSI3 listing, listProviders)
                                        │
                                        ▼
                                   [S3] Ask-a-Vet broadcast
                                        (fan-out + claim-on-reply
                                         + alert all vets push+email)
                                        │
                                        ▼
                                   [S4] Cleanup + docs
                                        (nutritionist coming-soon,
                                         confirm booking dormancy)
```

- **S0 blocks S1 and S3** (both need email).
- **S2 blocks S3** (broadcast needs the vet list).
- **S1 is independent of S2/S3** — can ship first for an early win.

---

## Slice S0 — SES email channel (foundation)
**Vertical path:** any Lambda → SNS publish → email consumer → SES → provider inbox.

- `src/lib/email.ts` — `sendEmail({ to, subject, html, text })` using `@aws-sdk/client-sesv2` (`SendEmailCommand`). Mirror `push.ts` shape (thin, throws on failure).
- New SNS consumer `src/functions/notifications/sendProviderEmail.ts` subscribed to `NotificationsTopic`, switches on `Subject`, looks up recipient, calls `sendEmail`. (Keep `sendPushNotification` untouched — two consumers, one topic.)
- `serverless.yml`: add `sendProviderEmail` fn (sns event), `ses:SendEmail` IAM, `FROM_EMAIL` env, SES verified identity resource (or document manual verification for dev).
- SSM/config: from-address e.g. `no-reply@furcircle.app`.

**Acceptance criteria**
- Publishing a test message with a known email subject sends a real email in dev (SES sandbox: to a verified address).
- Email failure logs and does NOT crash the publisher (non-fatal, same as push).

**Verification**
- `npm test` — unit test for `email.ts` (SES client mocked) + `sendProviderEmail` routing.
- `sls invoke local -f sendProviderEmail --path events/providerEmail.json --stage dev`.

**Checkpoint A — review before S1/S3.** Confirm from-address, SES sandbox vs production access, dev verified recipients.

---

## Slice S1 — Behaviourist email handoff
**Vertical path:** owner submits intake → record written `submitted` → behaviourist emailed full owner details → owner sees confirmation.

- `submitAssessment.ts`:
  - Status becomes terminal `'submitted'` (drop `pending`/approve-reject semantics); drop/ignore `vetResponse`, `reviewedAt`.
  - Replace 409 `ASSESSMENT_EXISTS` guard → simple anti-spam (e.g. one open submission per owner+behaviourist per 24h) or remove.
  - SNS publish carries full owner details for the email (subject `behaviourist_intake`): owner name, owner email, pet info, concern, media URLs. (Phone only if S4 decision adds it — see open question.)
- `sendProviderEmail.ts`: handle `behaviourist_intake` → fetch behaviourist email from `VET#{vetId}/PROFILE`, fetch owner `OWNER#/PROFILE` + dog `DOG#/PROFILE`, compose email.
- Leave dormant: `vetRespondToAssessment.ts` (approve/reject), `createBooking.ts` behaviourist branch.

**Acceptance criteria**
- POST `/assessments` for a behaviourist → 201, record `status:'submitted'`.
- Behaviourist receives email containing owner name/email + pet + concern.
- No approval step reachable from the owner happy path.

**Verification**
- Update `tests/functions/assessments/submitAssessment.test.ts` (status, no 409, SNS payload shape).
- `sls invoke local -f submitAssessment` + confirm email in dev.

**Checkpoint B — review before S2.**

---

## Slice S2 — Provider taxonomy (Veterinarian + Behaviourist)
**Vertical path:** admin-created vet record → appears in owner-facing provider list under `veterinarian`.

- Adopt `providerType: 'veterinarian'` as a first-class type. Ensure vet `VET#` profiles carry GSI3 keys (`GSI3PK=PROVIDER_TYPE#veterinarian`, `GSI3SK=RATING#…#VET#…`) so they list like behaviourists.
- `listProviders.ts`: add `veterinarian` to `VALID_TYPES`; drop the `canBook`/assessment coupling for vets (vets have no booking). Keep behaviourist path.
- Data backfill: one-off script/doc to tag existing vet records with GSI3 keys (admin-added means small N).
- `nutritionist` → flag coming-soon (S4), not surfaced as live.

**Acceptance criteria**
- `GET /providers?type=veterinarian` returns active vets sorted by rating.
- `GET /providers?type=behaviourist` unchanged.
- Invalid `type` → 400.

**Verification**
- `tests/functions/providers/listProviders.test.ts` — add veterinarian case.
- `sls invoke local -f listProviders --data '{"queryStringParameters":{"type":"veterinarian"}}'`.

**Checkpoint C — review broadcast data model before S3 (riskiest slice).**

---

## Slice S3 — Ask-a-Vet broadcast (the structural change)
**Vertical path:** owner posts question → all active vets alerted (push+email) → first vet replies & claims → owner gets the answer; other vets see it claimed.

**Data model**
- Thread created **unassigned**: `vetId: null`, `status: 'unassigned'`.
- Shared broadcast queue partition so every vet sees open questions:
  `GSI2PK = QUEUE#ask_a_vet`, `GSI2SK = OPEN#{createdAt}` (replaces per-vet `VET#{vetId}` until claimed).
- **Claim-on-reply** in `vetSendMessage.ts` / a new `claimThread`: conditional update
  `SET vetId=:v, status='open', GSI2PK='VET#'+v ConditionExpression attribute_type(vetId,'NULL') OR attribute_not_exists(vetId)`
  → second claimant gets `ConditionalCheckFailed` → 409 `ALREADY_CLAIMED`.
- Owner monthly limit logic preserved (welcome plan 1/month).

**Endpoints**
- `createThread.ts`: drop required `vetId`; write unassigned thread; publish `question_broadcast` (no single pushToken).
- New broadcast consumer path: on `question_broadcast`, query all active vets (GSI3 `PROVIDER_TYPE#veterinarian`) → push (those with token) + email each. Throttle/batch for N vets.
- Vet dashboard/list (`vetListThreads.ts`): include the shared `QUEUE#ask_a_vet` open items + the vet's claimed threads.
- `vetSendMessage.ts`: claim if unassigned, else require ownership.

**Acceptance criteria**
- Owner posts 1 question (welcome plan) → 201, thread `unassigned`.
- 2 active vets both receive alert (push and/or email).
- Vet A replies → thread `open`, `vetId=A`; Vet B reply attempt → 409 `ALREADY_CLAIMED`.
- Owner sees A's reply in the thread.
- Welcome plan second question same month → 403 `MONTHLY_LIMIT_REACHED`.

**Verification**
- New/updated tests: `createThread.test.ts`, `vetSendMessage.test.ts` (claim race via mocked ConditionalCheckFailed), `vetListThreads.test.ts`.
- `sls invoke local` sequence simulating 2 vets.

**Checkpoint D — review before cleanup. This slice is the one most likely to regress messaging.**

---

## Slice S4 — Cleanup, dormancy confirmation, docs
- `listProviders` / home screen: `nutritionist` → coming-soon (precedent: `complete_circle` plan).
- Confirm booking/credit/video stay dormant (Proactive hidden) — no code change expected; add a test asserting behaviourist no longer routes to bookings.
- Update `docs/openapi.yaml` (createThread no vetId; assessments terminal status; provider types).
- Update `docs/founder-homescreen-services-analysis.md` "what's been done".
- ADR: `docs/adr-ask-a-vet-broadcast.md` (why shared-queue + claim-on-reply, race handling).

**Acceptance criteria**
- OpenAPI matches handlers. Full suite green (except known integration test needing live AWS).

---

## Cross-cutting open question (decide in Checkpoint A/B)
- **Owner phone field.** Founder email spec lists phone, but owner profile has none (`postConfirmation.ts` writes firstName/lastName/email/pushToken/referralCode only). Options: (1) add `phone` (capture at onboarding / `PUT /owners/me`); (2) email-only handoff, behaviourist replies by email. Plan assumes (2) unless decided otherwise — choosing (1) adds a small task to S1.

## Risk register
| Risk | Slice | Mitigation |
|---|---|---|
| Double-claim race on broadcast | S3 | Conditional update on `vetId`, 409 on conflict |
| Fan-out cost/latency with many vets | S3 | Admin-added (small N) now; batch SES + skip tokenless push |
| SES sandbox blocks real sends | S0 | Verify recipients in dev; request production access before launch |
| Breaking reused messaging code | S3 | Vertical tests on claim + ownership; checkpoint D review |
| Pre-existing Proactive subscribers still booking | S4 | Doc caveat; decide ride-out vs migrate (no real subs assumed) |
