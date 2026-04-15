# FurCircle — Phase 3 Spec: Ask a Vet Messaging

## Scope

Build the async messaging system used by two features:
1. **Ask a Vet** — owner starts a thread with a real vet, free on all plans (Welcome: 1/month, Protector+: unlimited)
2. **Post-booking follow-up** — 7-day thread opened automatically after a consultation completes (reuses the same infrastructure)

Messaging is async: owner sends a message, vet responds when available, owner gets a push notification. No WebSockets.

Depends on: Phase 1 (auth + dog profile). Phase 4 (booking) will reuse the thread infrastructure built here.

---

## AWS Resources

No new infrastructure beyond what Phase 1 set up. Uses DynamoDB (Thread + Message entities from table design), SNS for push notifications, and EventBridge for the 7-day thread auto-close rule.

### EventBridge Rule — `furcircle-close-expired-threads`

| Setting  | Value                                           |
|----------|-------------------------------------------------|
| Schedule | `cron(0 1 * * ? *)` — 1:00 AM UTC daily        |
| Target   | Lambda: `closeExpiredThreads`                   |

---

## Subscription Gate — Ask a Vet

| Plan       | Ask a Vet allowance                  |
|------------|--------------------------------------|
| Welcome    | 1 thread per calendar month          |
| Protector  | Unlimited, priority response flagged |
| Proactive  | Unlimited, priority response flagged |

A "thread" counts toward the monthly limit when created. Replies within an existing thread are free.

---

## Lambda Functions

| Function              | Trigger                          | Purpose                                                  |
|-----------------------|----------------------------------|----------------------------------------------------------|
| `createThread`        | POST /threads                    | Start a new Ask a Vet thread                             |
| `listThreads`         | GET /threads                     | List all threads for the authenticated owner             |
| `getThread`           | GET /threads/{threadId}          | Get thread metadata + all messages                       |
| `sendMessage`         | POST /threads/{threadId}/messages| Owner sends a message in a thread                        |
| `markThreadRead`      | PUT /threads/{threadId}/read     | Mark all messages in thread as read by owner             |
| `closeExpiredThreads` | EventBridge daily                | Auto-close post-booking threads 7 days after booking end |

Vet-side handlers (reply, close thread) are in Phase 5 (Vet-facing API). For now, vets interact via the same endpoints using their JWT.

---

## API Endpoints

### POST /threads

Create a new Ask a Vet thread.

**Request body:**
```json
{
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "type": "ask_a_vet",
  "initialMessage": "Hi Buddy has been mouthing a lot more this week. Is that normal for a 3-month-old Golden?"
}
```

**Validation:**
- `vetId`: required, must be an active vet in DynamoDB
- `dogId`: required, must belong to authenticated owner
- `type`: required, must be `ask_a_vet` (post-booking threads are created by the system, not the owner)
- `initialMessage`: required, 1–2000 chars

**Lambda actions:**
1. Check subscription gate:
   - If `welcome` plan: query `GSI1: OWNER#${ownerId}, THREAD#ask_a_vet#${currentMonth}*` — if count ≥ 1, reject with 403
   - If `protector` or `proactive`: pass through
2. Generate `threadId` (UUID)
3. Write `THREAD#${threadId} / METADATA` record
4. Write first message: `THREAD#${threadId} / MSG#${epochMs}#${messageId}`
5. Send push notification to vet (via SNS): "New message from [owner name] about [dog name]"

**Response 201:**
```json
{
  "threadId": "uuid",
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "type": "ask_a_vet",
  "status": "open",
  "messages": [
    {
      "messageId": "uuid",
      "senderId": "owner-uuid",
      "senderType": "owner",
      "senderName": "Joshua",
      "body": "Hi Buddy has been mouthing a lot more this week...",
      "readAt": null,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ],
  "createdAt": "2026-04-15T10:00:00Z"
}
```

**Error cases:**

| Condition                           | Status | Error code                    |
|-------------------------------------|--------|-------------------------------|
| Welcome plan, 1 thread used already | 403    | `MONTHLY_LIMIT_REACHED`       |
| Vet not found / inactive            | 404    | `VET_NOT_FOUND`               |
| Dog not owned by user               | 403    | `FORBIDDEN`                   |

---

### GET /threads

List all threads for the authenticated owner, newest first.

**Query params:**
- `type` (optional): `ask_a_vet` or `post_booking` — filter by type
- `status` (optional): `open` or `closed`
- `limit` (optional): default 20, max 50
- `nextToken` (optional): pagination cursor (base64-encoded LastEvaluatedKey)

**Response 200:**
```json
{
  "threads": [
    {
      "threadId": "uuid",
      "type": "ask_a_vet",
      "status": "open",
      "vet": {
        "vetId": "vet-uuid",
        "firstName": "Sarah",
        "lastName": "Mitchell",
        "providerType": "behaviourist",
        "photoUrl": "https://..."
      },
      "dog": {
        "dogId": "dog-uuid",
        "name": "Buddy",
        "breed": "Golden Retriever"
      },
      "lastMessage": {
        "body": "Not at all — this is actually peak mouthing age...",
        "senderType": "vet",
        "createdAt": "2026-04-15T10:30:00Z"
      },
      "unreadCount": 1,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ],
  "nextToken": null
}
```

**Logic:**
1. Query `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK begins_with THREAD#` (optionally filter by type/status)
2. For each thread: batch-get vet profile + dog profile
3. Get last message: `PK=THREAD#${threadId}`, `SK begins_with MSG#`, `ScanIndexForward=false`, `Limit=1`
4. Count unread: query messages where `readAt` is null and `senderType=vet`

---

### GET /threads/{threadId}

Get full thread with all messages. Returns 403 if thread doesn't belong to authenticated user.

**Query params:**
- `limit` (optional): messages per page, default 50
- `nextToken` (optional): pagination cursor

**Response 200:**
```json
{
  "threadId": "uuid",
  "type": "ask_a_vet",
  "status": "open",
  "vet": {
    "vetId": "vet-uuid",
    "firstName": "Sarah",
    "lastName": "Mitchell",
    "providerType": "behaviourist",
    "photoUrl": "https://...",
    "specialisation": "Puppy behaviour & early socialisation"
  },
  "dog": {
    "dogId": "dog-uuid",
    "name": "Buddy",
    "breed": "Golden Retriever",
    "ageMonths": 3
  },
  "dogProfileVisible": true,
  "messages": [
    {
      "messageId": "uuid",
      "senderId": "owner-uuid",
      "senderType": "owner",
      "senderName": "Joshua",
      "body": "Hi Buddy has been mouthing a lot more this week...",
      "readAt": null,
      "createdAt": "2026-04-15T10:00:00Z"
    },
    {
      "messageId": "uuid",
      "senderId": "vet-uuid",
      "senderType": "vet",
      "senderName": "Dr. Sarah Mitchell",
      "body": "Hi Joshua! Yes, increased mouthing at 3 months is completely normal...",
      "readAt": null,
      "createdAt": "2026-04-15T10:05:00Z"
    }
  ],
  "nextToken": null,
  "createdAt": "2026-04-15T10:00:00Z",
  "closedAt": null
}
```

**Note:** `dogProfileVisible: true` means the vet can see the dog's full health profile. Always true for threads — the UI shows "The vet can see your dog's full wellness history."

---

### POST /threads/{threadId}/messages

Owner sends a message in an existing thread.

**Request body:**
```json
{
  "body": "Should I be worried about it getting worse?"
}
```

**Validation:**
- Thread must exist and belong to authenticated owner
- Thread must be `status: open`
- `body`: required, 1–2000 chars

**Lambda actions:**
1. Verify thread ownership and open status
2. Write `MSG#${epochMs}#${messageId}` record
3. Send push notification to vet: "New message from [owner name]"

**Response 201:**
```json
{
  "messageId": "uuid",
  "threadId": "uuid",
  "senderId": "owner-uuid",
  "senderType": "owner",
  "body": "Should I be worried about it getting worse?",
  "readAt": null,
  "createdAt": "2026-04-15T10:10:00Z"
}
```

**Error cases:**

| Condition          | Status | Error code        |
|--------------------|--------|-------------------|
| Thread not found   | 404    | `THREAD_NOT_FOUND`|
| Thread is closed   | 403    | `THREAD_CLOSED`   |
| Not thread owner   | 403    | `FORBIDDEN`       |

---

### PUT /threads/{threadId}/read

Mark all unread vet messages in a thread as read by the owner. Called when the owner opens the thread.

**Request body:** none

**Lambda actions:**
1. Query all messages in thread where `senderType=vet` and `readAt` is null
2. Batch update each message: set `readAt = now`

**Response 200:**
```json
{
  "threadId": "uuid",
  "markedRead": 2
}
```

---

## Post-Booking Thread Creation (System-initiated)

When a booking is marked `completed` (Phase 4), the system automatically creates a 7-day follow-up thread. This Lambda (`createPostBookingThread`) is called internally by the booking completion flow, not via HTTP.

**Actions:**
1. Generate `threadId`
2. Write `THREAD#${threadId} / METADATA` with `type=post_booking, status=open, bookingId=${bookingId}`
3. Set `closedAt` = `scheduledAt + 7 days` (ISO 8601)
4. Write system opening message from vet: "Your consultation with [owner name] for [dog name] has completed. This thread is open for 7 days for follow-up questions."
5. Send push notification to owner: "Your 7-day follow-up thread with Dr. [name] is now open 🐾"

---

## Auto-Close Expired Threads (EventBridge)

### closeExpiredThreads Lambda

Fires daily at 1:00 AM UTC.

**Actions:**
1. Scan for all `post_booking` threads where `status=open` and `closedAt <= now`
   - Uses a GSI2 query across all vets (or a dedicated scan with FilterExpression — acceptable at current scale)
2. For each expired thread:
   - Update `status=closed`
   - Send push notification to owner: "Your follow-up thread with Dr. [name] has closed. The conversation has been saved to Buddy's profile."
3. Log count of threads closed.

**Note:** At scale, replace with a DynamoDB TTL on the `closedAt` field triggering a DynamoDB Stream → Lambda. For MVP, the daily EventBridge scan is sufficient.

---

## Push Notification Payloads

| Event                    | Recipient | Title                          | Body                                              |
|--------------------------|-----------|--------------------------------|---------------------------------------------------|
| New thread created       | Vet       | "New message from Joshua"      | "About Buddy (Golden Retriever, 3 months)"        |
| Owner sends message      | Vet       | "New message from Joshua"      | Message body truncated to 100 chars               |
| Vet sends message        | Owner     | "Dr. Sarah replied"            | Message body truncated to 100 chars               |
| Post-booking thread open | Owner     | "Your follow-up is ready 🐾"   | "Your 7-day thread with Dr. Sarah Mitchell is open"|
| Thread auto-closed       | Owner     | "Follow-up thread closed"      | "Saved to Buddy's profile permanently."            |

All notifications stored in DynamoDB `NOTIF#` entity for in-app notification inbox.

---

## IAM Permissions (Phase 3)

| Lambda               | DynamoDB                             | SNS     |
|----------------------|--------------------------------------|---------|
| createThread         | PutItem (x2), GetItem (x2), Query    | Publish |
| listThreads          | Query, BatchGetItem                  | —       |
| getThread            | GetItem, Query                       | —       |
| sendMessage          | GetItem, PutItem                     | Publish |
| markThreadRead       | Query, BatchWrite                    | —       |
| closeExpiredThreads  | Query/Scan, UpdateItem (batch)       | Publish |

---

## Open Questions

- [ ] Can owners close a thread themselves (e.g. "mark as resolved"), or only the system closes them?
- [ ] Protector plan gets "priority response" — does this mean anything in the backend (e.g. a flag on the thread, separate vet queue), or is it just a marketing label?
- [ ] Message media attachments (photos/video from owner to vet) — in scope for Phase 3, or defer?
- [ ] Ask a Vet monthly limit reset — on calendar month boundary (1st of month) or 30 days rolling from last thread creation?
