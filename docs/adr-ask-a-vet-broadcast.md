# ADR: Ask-a-Vet broadcast with claim-on-reply

- **Status:** Superseded (2026-06-13) — see "Superseding decision" below
- **Date:** 2026-06-08
- **Context phase:** Phase 9 — provider split + notifications

> ## Superseding decision (2026-06-13): shared group chat, no claim
>
> The founder revised the model again: Ask-a-Vet should be a **shared group
> chat**, not an exclusive claim. **Multiple vets** can read and answer the same
> question for the one owner — there is no "first vet wins" lock.
>
> **What changed:**
> - Threads are created with `status: 'open'` (not `'unassigned'`) and
>   `GSI2SK = THREAD#open#${createdAt}`. `vetId` stays `null` permanently for
>   group threads — no vet "owns" the conversation.
> - `vetSendMessage` no longer claims: the conditional update, the
>   `vetId`/`GSI2PK` flip, and the `409 ALREADY_CLAIMED` race response are
>   removed. Any vet may post while `vetId === null`; a concrete `vetId` (private
>   1:1) is still locked to that vet.
> - The thread stays in the `QUEUE#ask_a_vet` partition (visible to every vet)
>   until it is **closed** — `vetCloseThread` flips `GSI2SK` to
>   `THREAD#closed#…`, which removes it from the open queue. Any vet may close a
>   group thread.
> - `vetGetThread` / `vetMarkThreadRead` gate on `vetId == null || vetId === me`
>   instead of status.
> - `vetListThreads` queues on the `THREAD#open#` prefix and includes the queue
>   unless filtering by a non-open status.
> - Owner `getThread` resolves **every** vet sender on the page (BatchGet) and
>   returns a `vets[]` array; each message carries its author's `senderName`.
> - Owner `sendMessage` notifies **all** vets who have replied to the thread,
>   not a single assigned vet.
> - Contract: thread `status` enum is now `[open, closed]`; `409 ALREADY_CLAIMED`
>   is gone (OpenAPI updated).
>
> The "Context" and "Alternatives considered" below remain useful history; the
> "Decision" section reflects the prior claim-on-reply model, now replaced.

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
