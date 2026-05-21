# FurCircle — Phase 7 Spec: Push Notifications

## Scope

End-to-end push notification delivery for all platform events:
- Centralised SNS → Expo Push fanout Lambda (`sendPushNotification`)
- Push token registration endpoint for owners
- Push token registration endpoint for vets

Depends on: Phase 1 (owner profile), Phase 5 (vet profile).

---

## Architecture

All server-side notification triggers already publish to the `NotificationsTopic` SNS topic. Phase 7 completes the delivery chain:

```
Any Lambda (threads, bookings, assessments, plan)
  → SNS Publish (subject + JSON payload)
    → sendPushNotification Lambda (SNS subscriber)
      → GetItem OWNER#${ownerId}/PROFILE (reads pushToken)
        → POST https://exp.host/--/api/v2/push/send (Expo Push API)
```

Push tokens are stored directly on the owner/vet PROFILE record as `pushToken`. No separate token table needed.

---

## Lambda Functions

| Function                  | Trigger                              | Purpose                                        |
|---------------------------|--------------------------------------|------------------------------------------------|
| `sendPushNotification`    | SNS: NotificationsTopic              | Route SNS events → Expo push notifications     |
| `registerOwnerPushToken`  | PUT /owners/me/push-token            | Save/update Expo push token on owner profile   |
| `registerVetPushToken`    | PUT /vet/me/push-token               | Save/update Expo push token on vet profile     |

---

## sendPushNotification (P7-T1 — complete)

SNS subscriber Lambda. Processes all notification events from the platform.

**Event format (SNS record):**
- `Subject`: notification type string (see table below)
- `Message`: JSON string with `ownerId` + event-specific fields

**Logic per record:**
1. Parse subject + payload from SNS record
2. `buildMessage(subject, payload)` → `{ body, data }` or `null` for unknown subjects
3. Skip if `null` or no `ownerId`
4. GetItem `OWNER#${ownerId}/PROFILE` → read `pushToken`
5. Skip silently if `pushToken` is null/absent
6. POST to Expo Push API — errors caught and logged, never re-thrown

**Supported subjects:**

| Subject               | Body                                                        | data fields                          |
|-----------------------|-------------------------------------------------------------|--------------------------------------|
| `plan_ready`          | `"{dogName}'s monthly wellness plan is ready 🐾"`          | `type, dogId`                        |
| `new_vet_message`     | `"You have a new message from your vet"`                    | `type, threadId`                     |
| `new_owner_message`   | `"Your vet received your message"`                          | `type, threadId`                     |
| `thread_closed`       | `"Your consultation thread has been closed"`                | `type, threadId`                     |
| `assessment_responded`| `"Your assessment has been {decision} by the vet"`         | `type, assessmentId, decision`       |
| `new_booking`         | `"Your consultation booking is confirmed ✅"`              | `type, bookingId`                    |
| `booking_cancelled`   | `"Your booking has been cancelled"`                         | `type, bookingId`                    |

Unknown subjects are silently skipped (no error, no push).

**Expo Push message shape:**
```json
{
  "to": "ExponentPushToken[...]",
  "title": "FurCircle",
  "body": "...",
  "sound": "default",
  "data": { "type": "...", "..." : "..." }
}
```

---

## P7-T2 — registerOwnerPushToken

### PUT /owners/me/push-token

Called by the mobile app on startup (after auth) and when Expo issues a new token.

**Auth:** Cognito JWT (cognitoAuthorizer). `getUserId(event)` extracts `ownerId`.

**Request body:**
```json
{ "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

**Validation:**
- `pushToken` required, string, must start with `ExponentPushToken[` or `ExpoPushToken[` (400 `INVALID_TOKEN`)

**Lambda actions:**
1. Extract `ownerId` from JWT
2. Validate token format
3. UpdateItem `OWNER#${ownerId}/PROFILE`: `SET pushToken = :token, updatedAt = :now`

**Response 200:**
```json
{ "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

**Errors:**

| Code            | Status | Condition         |
|-----------------|--------|-------------------|
| `INVALID_TOKEN` | 400    | Bad token format  |

**IAM:** `dynamodb:UpdateItem` on table.

---

## P7-T3 — registerVetPushToken

### PUT /vet/me/push-token

Same pattern as owner endpoint but for vets. Uses `vetAuthorizer`.

**Auth:** Cognito JWT (vetAuthorizer). `getUserId(event)` extracts `vetId`.

**Request body:**
```json
{ "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

**Validation:** Same as owner endpoint.

**Lambda actions:**
1. Extract `vetId` from JWT
2. Validate token format
3. UpdateItem `VET#${vetId}/PROFILE`: `SET pushToken = :token, updatedAt = :now`

**Response 200:**
```json
{ "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

**IAM:** `dynamodb:UpdateItem` on table.

**Note:** `sendPushNotification` currently reads `pushToken` from OWNER profiles only. Vet push delivery (e.g. new assessment, new booking) requires a parallel flow: publish SNS with `vetId`, Lambda reads `VET#${vetId}/PROFILE`. This is out of scope for P7 — vet push delivery can be added in a future phase when the vet mobile app ships.

---

## IAM Permissions (Phase 7)

| Lambda                   | DynamoDB    | SNS         |
|--------------------------|-------------|-------------|
| sendPushNotification     | GetItem     | (subscriber)|
| registerOwnerPushToken   | UpdateItem  | —           |
| registerVetPushToken     | UpdateItem  | —           |

---

## Design Decisions

- **Token stored on PROFILE record** — avoids a separate token table/index. `sendPushNotification` already does a GetItem on the profile to get the owner name (future) — no extra read cost.
- **No token dedup/validation against Expo** — Expo tokens don't expire in the traditional sense; the push simply fails silently if the token is stale. Expo recommends re-registering on each app launch, which this endpoint supports idempotently.
- **Soft failure** — `sendPushNotification` catches all errors per-record and continues. A failed push never blocks other records in the same batch or propagates to the SNS retry mechanism.
- **Vet push deferred** — vet mobile app is not in scope for Phase 7. The infrastructure (token storage + endpoint) is ready; delivery logic can be added without a schema change.
