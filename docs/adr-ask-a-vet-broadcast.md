# ADR: Ask-a-Vet broadcast with claim-on-reply

- **Status:** Accepted
- **Date:** 2026-06-08
- **Context phase:** Phase 9 — provider split + notifications

## Context

Originally Ask-a-Vet was a 1:1 private chat: the owner picked one vet at
thread-creation time, and `vetId` was baked into the thread metadata, the
`GSI2PK = VET#${vetId}` partition (the vet's thread list), and the push target.

The founder's revised model: an owner asks a question and **every** vet is
alerted; **any** vet can answer, and whoever replies first owns the
conversation. This decouples the question from a specific vet and turns
Ask-a-Vet into a shared queue.

## Decision

Create questions **unassigned** and let the first replying vet **claim** them.

### Data model
- Thread is created with `vetId: null`, `status: 'unassigned'`.
- It is placed in a **shared broadcast partition** on GSI2:
  `GSI2PK = QUEUE#ask_a_vet`, `GSI2SK = THREAD#unassigned#${createdAt}`.
  Every vet queries this one partition to see open questions.
- The owner's own list is unchanged (`GSI1PK = OWNER#${ownerId}`).

### Claim-on-reply (race-safe)
`vetSendMessage` claims an unassigned thread on the first reply with a
**conditional update**:
```
SET vetId = :v, status = 'open', GSI2PK = VET#${v}, GSI2SK = THREAD#open#${createdAt}
ConditionExpression: status = 'unassigned'
```
- The condition guarantees only one vet wins. A loser gets
  `ConditionalCheckFailedException` → **409 ALREADY_CLAIMED**.
- On claim the thread moves out of `QUEUE#ask_a_vet` into the claimer's
  `VET#${vetId}` partition, so it leaves every other vet's queue and enters the
  owner's vet's normal thread list.

### Fan-out alerts
`createThread` publishes `question_broadcast` to the notifications topic. Both
SNS consumers fan out to **all active veterinarians** (looked up via
`listActiveVeterinarians`, GSI3 `PROVIDER_TYPE#veterinarian`):
- `sendPushNotification` → Expo push to vets with a token.
- `sendProviderEmail` → SES email to vets with an address.

### Vet listing
`vetListThreads` merges two GSI2 queries: the vet's own `VET#${vetId}` threads
plus the shared `QUEUE#ask_a_vet` unassigned threads (skipped when filtering by
a concrete status).

## Alternatives considered

1. **Assignment service / round-robin.** A coordinator picks one vet per
   question. Rejected: adds a stateful component and defeats "any vet can jump
   in"; also needs availability tracking we don't have.
2. **Fan-out copies (one thread row per vet).** Write N thread rows, delete the
   rest on claim. Rejected: write amplification, cleanup complexity, and a
   harder consistency story than a single shared row + conditional claim.
3. **Optimistic claim without a condition.** Last-writer-wins on `vetId`.
   Rejected: two vets could both believe they own the thread. The conditional
   update is the cheap correctness guarantee.

## Consequences

- **Breaking API change:** `POST /threads` no longer accepts/needs `vetId`.
  Old clients that still send it are tolerated (ignored), but the UX shifts from
  "pick a vet" to "ask, any vet answers." Mobile client must update.
- New thread status `unassigned` is now part of the contract (OpenAPI updated).
- Broadcast cost scales with vet count (push + email per question). Acceptable
  now because providers are admin-added (small N); revisit batching/digest if
  the vet roster grows large.
- Veterinarians must carry GSI3 keys to be found by the fan-out and the listing
  (`scripts/backfill-vet-gsi3.ts`).
- A late-arriving vet reply after a claim fails closed with 409 rather than
  appending to someone else's conversation.
