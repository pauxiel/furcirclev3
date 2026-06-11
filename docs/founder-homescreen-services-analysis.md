# FurCircle — Can the new Home Screen plan fit the current build?

> Analysis of the founder's clarified Home Screen services workflow (Ask a Vet, Behaviourist, two provider types, drop video) against the current codebase. No code has been changed.

**Short answer: yes, and most of it is actually *simpler* than what we already built.** The app already has two provider types, a messaging system, provider profiles, and notifications wired up. The founder's MVP is mostly *trimming and reshaping* what exists rather than building from scratch. A few pieces, though, touch the "core" of the app and need care — and two of them need a business decision before we code.

## What already lines up (little or no work)

- **Two provider types** — the system is already built around the idea of different provider categories. Adding "Veterinarian" and "Behaviourist" as the two live ones, and tagging the rest "Coming Soon," fits naturally.
- **Provider profiles** — Full Name, Bio, and Profile Photo already exist. We'd add two missing fields: **Title** and **Notification Preferences**. Small.
- **The behaviourist "submit your details" idea** — a request/intake flow already exists. We're simplifying it, not inventing it.

## What needs real reshaping (planned work, fits cleanly)

1. **"Ask a Vet" → send to *all* vets.** Right now a question goes to *one* vet the owner picks, like a private chat. The founder wants it broadcast to every vet, with any of them able to answer. This is the single biggest structural change — it changes how a question is stored and how vets see it. Doable, but it's the part most likely to cause bugs if rushed.
2. **Notify vets by email/text.** Today the app only sends in-app pop-up notifications. The founder's model assumes vets get an **email or SMS** (they may not be sitting in the app). We need to add that delivery channel. This is important — the whole "any vet can jump in" idea depends on vets actually being alerted.
3. **Behaviourist = email the owner's details, then they talk off-platform.** Today behaviourist requests run through an in-app **approve/reject step and then a paid video booking**. The founder wants to skip all that — just email the behaviourist the owner's name, phone, email, pet info, and concern, and let them follow up directly. This is mostly *removing* steps, which is good, but see the warning below.

## The big ones — could break things / need a decision first

These are where I'd pause before touching code:

1. **Dropping video consultations pulls a thread that's tied to the paid plan.** Our current paid tier (the $39.99 "Proactive Parent" plan) is literally built around **video-call credits**. The booking system, the credit balance, and the behaviourist flow are all wired into video. If we remove video and simplify behaviourist to "just email me," the paid plan loses its main selling point and the credit system partly loses its purpose. **This isn't just a code change — it's a pricing/product decision.** What does the paid plan offer now? We need the founder's direction here.

2. **There's no provider sign-up yet.** The founder describes providers choosing "Veterinary" or "Behaviourist" when they join. Today, pet owners self-register, but **providers don't have a sign-up flow** — they appear to be added manually behind the scenes. If providers need to self-register and pick their type at launch, that's a new piece to build. If we can add providers manually for the MVP, this can wait.

3. **Behaviourist and the booking system are entangled.** Because the old behaviourist flow feeds into bookings and credits, simplifying it cleanly means carefully untangling those connections so we don't break the booking code that's still used elsewhere.

## Bottom line

About **70% of this is simplification and small additions** — good news, the founder's MVP is *lighter* than what we built. The risky 30% is: (a) rewiring "Ask a Vet" to reach all vets, (b) adding email/SMS alerts to providers, and (c) deciding what the **paid plan and credits** mean once video is gone. Recommendation: get the founder's call on the pricing/video question first, since it shapes everything else.

---

## Decision — hide Proactive, keep Free + Protector (2026-06-01)

**Direction:** Two plans reign — **Free (Welcome)** and **Protector ($14.99)**. **Proactive Parent ($39.99) gets hidden as "Coming Soon"**, not removed. Video calls and the behaviourist booking flow are *downstream* of the Proactive plan, so hiding Proactive hides them too — no need to delete that code.

### What the code actually showed

- **3 paid tiers live + 1 already "Coming Soon":** `welcome` (free), `protector`, `proactive`, plus `complete_circle` which is **already `comingSoon: true`**. The coming-soon pattern exists — we're following precedent, not inventing.
- **Video calls = bookings = gated on Proactive.** `createBooking.ts:40` rejects with 403 unless `sub.plan === 'proactive'`. Agora token (`getAgoraToken.ts`) is the actual video call. Credits are deducted per booking.
- **Behaviourist booking = Proactive + approved assessment** (`createBooking.ts:53`).
- **Key consequence:** if nobody can *buy* Proactive, `createBooking` returns 403 for everyone automatically. Video calls + behaviourist booking go **dormant without touching their code.**
- **Providers are already added manually** (admin/back-office). No self-signup exists. The founder's "we register providers ourselves" = current reality, zero work.

### Options considered

| | **A — Flag flip (hide only)** | **B — Hide + guard** | **C — Rip out** |
|---|---|---|---|
| **What** | Flip Proactive → coming-soon, block the buy endpoint. Leave booking/credit/assessment/Agora dormant. | A + dormant endpoints return clean `COMING_SOON` instead of incidental 403/402. | Delete Proactive, bookings, credits, Agora, assessments entirely. |
| **Effort** | ~2 files, <1hr | ~5 files, half day | Days; touches schema, IAM, step funcs |
| **Re-enable** | Flip one flag | Flip flags | Rebuild from scratch |
| **Risk** | Near zero | Low | High — booking code reused by cancelBooking/listBookings/getBooking |

**Chosen: Option A.** UI won't surface the dormant endpoints anyway, so guards (B) only matter for a rogue client — edge case not worth the extra work. C burns the re-enable path and risks reused booking code.

### Edit plan (Option A)

**File 1 — `getSubscriptionPlans.ts`** (display data only): flip the `proactive` block — `price: null`, `interval: null`, `credits: null`, `badge: 'Coming Soon'`, `comingSoon: true`, `stripePriceId: null`. Move the freed-up "Most Popular" badge onto `protector`.

**File 2 — `subscribeToPlan.ts`** (buy endpoint): add `const SELLABLE_PLAN_KEYS = ['protector'] as const;` and validate `planKey` against it (line ~28). Leave the `VALID_PLAN_KEYS` union and `PLAN_PRICE_IDS` map intact so TypeScript stays clean and the credit logic below is untouched. POST `planKey: 'proactive'` → 400.

**Untouched / dormant by design:** `createBooking.ts`, `submitAssessment.ts`, `getAgoraToken.ts`, all booking reads. Provider registration stays manual.

**One deviation — `topUpCredits.ts` needed an explicit guard, not just dormancy.** Unlike `createBooking`, the credit top-up endpoint had **no plan check at all** — any Free/Protector user could buy credit packages they can never spend (credits are only consumed by Proactive video bookings). Leaving it "dormant" would have taken real money for nothing. Fix: added the same proactive gate `createBooking` uses — `if (sub.plan !== 'proactive') return 403`. Top-ups are now blocked for everyone while Proactive is hidden, and re-open automatically when Proactive returns. This keeps the spirit of Option A (flip-to-re-enable) while closing a payment leak.

**Re-enable later:** flip `comingSoon` back + re-add `proactive` to sellable keys. One commit reverts it.

Scope: three files (`getSubscriptionPlans.ts`, `subscribeToPlan.ts`, `topUpCredits.ts`), no schema/IAM/step-function changes. Tests for all three updated and passing.

### Open question (business, not code)

Once video is hidden, **what justifies Protector at $14.99?** Its value stands without video calls — unlimited Ask-a-Vet + free behaviour assessment + monthly training video library + daily nudges. Confirm the pitch is "unlimited vet access," not "video."

---

## What's been done (2026-06-02)

Option A is **implemented and tested.**

**Shipped changes:**
- `getSubscriptionPlans.ts` — Proactive flipped to Coming Soon (`price/interval/credits/stripePriceId: null`, `badge: 'Coming Soon'`, `comingSoon: true`). "Most Popular" badge moved to Protector. App now shows Free + Protector buyable; Proactive + Complete Circle both greyed.
- `subscribeToPlan.ts` — added `SELLABLE_PLAN_KEYS = ['protector']`; buying Proactive now returns 400. Type union + price map kept intact so re-enable is a one-line flip.
- `topUpCredits.ts` — added a Proactive gate (`plan !== 'proactive'` → 403). Closed a real payment leak: the endpoint previously had **no plan check**, so any Free/Protector user could buy credit packages they could never spend.

**Bonus bug fixed (found while running the suite):**
- `addHealthRecord.ts` — used bare `crypto.randomUUID()` with no import → `ReferenceError: crypto is not defined` at runtime. That endpoint would have 500'd on every call in production. Swapped to `import { v4 as uuidv4 } from 'uuid'` (codebase convention).
- `getMedicalRecordUploadUrl.test.ts` — stale test (sent `contentType` in body; handler reads it from the query string after the recent GET refactor). Test rewired to match; obsolete "invalid JSON body" case removed.

**Test results:** 448 passing. The only remaining failure is `tests/integration/owners.test.ts`, which needs live AWS/Cognito credentials + `--experimental-vm-modules` — an environment gap, pre-existing and unrelated to this work.

**Re-enable Proactive later:** flip `comingSoon` back in `getSubscriptionPlans.ts` and re-add `'proactive'` to `SELLABLE_PLAN_KEYS`. The booking / credit / assessment / Agora code stayed in place, dormant.

## Not done yet (separate workstream)

The **Ask-a-Vet rewrite is untouched.** Still one-vet private chat, not broadcast-to-all-vets. Email/SMS provider alerts and the "email the behaviourist the owner's details" off-platform flow are also not built. These are the risky structural items from the analysis above and need their own spec before coding.

## Founder clarification — the two providers (2026-06-02)

Two provider types, two distinct jobs. Nothing else.

- **Vet → Ask-a-Vet only.** Answers owner questions. No bookings, no video.
- **Behaviourist → receive owner details after the assessment form.** Owner fills the assessment form → behaviourist receives an **email** with the owner's details → behaviourist follows up **off-platform** on their end. No approve/reject, no in-app booking, no video, no credits.

### Paid video booking — already unreachable

Under the two supported plans (Free + Protector), paid video booking is **already dormant**. `createBooking.ts:40` requires `plan === 'proactive'`, and Proactive is hidden / unbuyable → every booking attempt returns 403. The behaviourist rework is therefore *not* disabling a live flow; it's adding the new email path and cleaning up dead approve/reject + booking wiring.

> **Caveat:** any owner who subscribed to Proactive *before* the hide still has `plan: 'proactive'` in DynamoDB and could book until their period ends. Non-issue if there are no real Proactive subscribers yet — needs a decision (ride out vs. migrate/refund) if there are.

### Behaviourist flow — what the code needs (not built yet)

`submitAssessment.ts` already does ~60%: form validation (behaviourist `vetId`, `dogId`, `description` ≥50 chars, ≤3 media URLs), writes the assessment record, publishes a thin SNS push.

**Change:**
1. Status semantics — today `status: 'pending'` + `vetResponse` + `reviewedAt` imply an approve/reject lifecycle. New flow has no approval → status becomes terminal `'submitted'`; drop/ignore `vetResponse`/`reviewedAt`.
2. Notification → real **email** to the behaviourist carrying the owner's details (today's SNS payload is ids only). **Depends on the email channel (SES) — same channel Ask-a-Vet needs.**
3. The 409 "active assessment exists" guard (`submitAssessment.ts:58`) was built for the old lifecycle — drop or repurpose as simple anti-spam.

**Remove / leave dormant:** vet-side approve/reject Lambda; `createBooking` behaviourist branch (already dormant); credits/video.

### Schema check — data for the behaviourist email

| Field needed in email | Source | Status |
|---|---|---|
| Owner name | `OWNER#/PROFILE` → firstName, lastName | exists |
| Owner email | `OWNER#/PROFILE` → email | exists |
| Behaviourist email (recipient) | `VET#` provider record → email | exists |
| Pet info | `DOG#/PROFILE` | exists |
| Concern + media | assessment form (`description`, `mediaUrls`) | exists |
| **Owner phone** | — | **missing — no phone field on owner profile** |

### Open question (decide before building)

Founder's description (doc line 17) lists "name, **phone**, email, pet info, concern" in the behaviourist email — but the owner profile has **no phone field** (`postConfirmation.ts` writes only firstName/lastName/email/pushToken/referralCode). Two options, deferred:

1. **Add `phone` to owner profile** — capture at onboarding or via `PUT /owners/me`. Behaviourist gets a number for direct follow-up. Cost: new field + a collection point.
2. **Email only, no phone** — behaviourist replies to the owner by email; owner shares phone if they want. Zero new fields, ships faster.

Everything else for the behaviourist email already exists — phone is the only open data item.

---

## What's been done — Phase 9 (2026-06-08)

The full provider-split + notifications workstream is **built and tested** (469 unit tests green, tsc clean). Plan + task list: `tasks/plan-phase9-provider-split-notifications.md`, `tasks/todo-phase9-provider-split-notifications.md`. ADR for the broadcast model: `docs/adr-ask-a-vet-broadcast.md`.

**Decisions locked:** Email (SES) + keep push (SMS deferred) · Vet = Ask-a-Vet broadcast to all vets · Behaviourist = email handoff · Providers admin-added · Owner phone = **email-only** (no phone field).

**Shipped (commits 16e607b → 3b5fb27):**
- **S0 — Email channel.** New `src/lib/email.ts` (SESv2) + second SNS consumer `sendProviderEmail`. Deployed to dev and smoke-tested live (real email delivered). Push path untouched.
- **S1 — Behaviourist handoff.** `submitAssessment` writes terminal `submitted` (no approve/reject), emails the behaviourist the owner's name/email/dog/concern. Old 409 → 24h anti-spam.
- **S2 — Veterinarian provider type.** `listProviders?type=veterinarian` lists vets rating-sorted, no booking coupling. Backfill script `scripts/backfill-vet-gsi3.ts`.
- **S3 — Ask-a-Vet broadcast.** `POST /threads` drops `vetId`; questions go to a shared queue, broadcast (push+email) to all active vets; first vet to reply claims via conditional write (loser → 409). `vetListThreads` shows queue + own threads.
- **S4 — Cleanup.** `nutritionist` made coming-soon (data retained, not a live type). OpenAPI synced. ADR written.

**Open before launch / client release:**
1. **Breaking change** — `POST /threads` no longer takes `vetId`. Mobile client must update (pick-a-vet → ask-any-vet).
2. **SES production access** — account still in sandbox (only verified recipients receive mail).
3. **Backfill** — run `scripts/backfill-vet-gsi3.ts --apply` once veterinarians are admin-added (dev has none yet).
4. **Deploy S2+S3** to dev (S0+S1 already deployed).
