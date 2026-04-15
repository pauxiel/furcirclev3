# FurCircle — Phase 5 Spec: Vet-Facing API

## Scope

Everything a vet needs to operate on FurCircle:
- Vet auth (same Cognito User Pool as owners, `vets` group)
- Vet profile management
- Assessment queue: view + respond to pending assessments
- Availability management: set open/blocked slots
- Booking management: view upcoming schedule, join call, submit post-call summary
- Messaging: reply to owner threads (Ask a Vet + post-booking follow-ups)
- Notifications for all vet-facing events

A JWT authorizer Lambda (`vetAuthorizer`) validates that the caller is in the `vets` Cognito group before any vet endpoint is reached.

Depends on: Phase 1 (auth infrastructure), Phase 3 (messaging), Phase 4 (booking + assessment).

---

## Auth: Vet vs Owner

Same Cognito User Pool. Group determines access:

| Group    | Can call owner endpoints | Can call vet endpoints |
|----------|--------------------------|------------------------|
| `owners` | Yes                      | No (403)               |
| `vets`   | No (403)                 | Yes                    |

**Vet authorizer Lambda (`vetAuthorizer`):**
- Validates Cognito JWT (same as owner authorizer)
- Additionally checks `cognito:groups` claim includes `vets`
- Returns `Allow` policy if valid, `Deny` otherwise
- Extracts `vetId` (= Cognito sub) into Lambda context for downstream functions

**Base path:** All vet endpoints are prefixed `/vet/` to make routing unambiguous.

---

## Vet Onboarding

Vets are created by an admin operation (not self-sign-up in Phase 5). Admin creates the Cognito user, assigns to `vets` group, and creates the VET# profile record in DynamoDB. A separate admin API can be added later if needed.

---

## Lambda Functions

| Function                   | Trigger                                          | Purpose                                             |
|----------------------------|--------------------------------------------------|-----------------------------------------------------|
| `vetGetProfile`            | GET /vet/me                                      | Get vet's own profile                               |
| `vetUpdateProfile`         | PUT /vet/me                                      | Update bio, specialisation, photo                   |
| `vetGetDashboard`          | GET /vet/dashboard                               | Summary: pending assessments, today's bookings, open threads |
| `vetListAssessments`       | GET /vet/assessments                             | List assessments in queue                           |
| `vetGetAssessment`         | GET /vet/assessments/{assessmentId}              | Get full assessment including dog profile           |
| `vetRespondToAssessment`   | PUT /vet/assessments/{assessmentId}/respond      | Approve or reject with written response             |
| `vetGetAvailability`       | GET /vet/availability                            | Get current availability for date range             |
| `vetSetAvailability`       | PUT /vet/availability/{date}                     | Set/update slots for a specific date                |
| `vetBulkSetAvailability`   | PUT /vet/availability                            | Set availability for multiple dates at once         |
| `vetListBookings`          | GET /vet/bookings                                | List upcoming and past bookings                     |
| `vetGetBooking`            | GET /vet/bookings/{bookingId}                    | Get full booking + owner + dog context              |
| `vetGetAgoraToken`         | GET /vet/bookings/{bookingId}/token              | Generate Agora token (same logic as owner side)     |
| `vetSubmitPostCallSummary` | POST /vet/bookings/{bookingId}/summary           | Submit post-call notes, triggers follow-up thread   |
| `vetListThreads`           | GET /vet/threads                                 | List all message threads assigned to this vet       |
| `vetGetThread`             | GET /vet/threads/{threadId}                      | Get thread + full message history + dog profile     |
| `vetSendMessage`           | POST /vet/threads/{threadId}/messages            | Reply to owner in thread                            |
| `vetCloseThread`           | PUT /vet/threads/{threadId}/close                | Manually close a thread                             |
| `vetMarkThreadRead`        | PUT /vet/threads/{threadId}/read                 | Mark owner messages as read                         |
| `vetGetNotifications`      | GET /vet/notifications                           | List vet's notifications                            |
| `vetMarkNotificationRead`  | PUT /vet/notifications/{notificationId}/read     | Mark notification read                              |
| `vetUploadPhotoUrl`        | POST /vet/me/photo                               | Presigned S3 URL for vet profile photo              |

---

## API Endpoints

### GET /vet/me

Returns the vet's own profile.

**Response 200:**
```json
{
  "vetId": "cognito-uuid",
  "firstName": "Emma",
  "lastName": "Clarke",
  "email": "emma@furcircle.com",
  "providerType": "behaviourist",
  "specialisation": "Puppy behaviour & early socialisation",
  "bio": "Dr. Emma Clarke has 8 years experience...",
  "photoUrl": "https://...",
  "rating": 4.9,
  "reviewCount": 71,
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### PUT /vet/me

Update editable profile fields.

**Request body** (all optional):
```json
{
  "bio": "Updated bio text...",
  "specialisation": "Puppy behaviour & early socialisation",
  "isActive": true
}
```

**Response 200:** Updated vet profile (same shape as GET /vet/me).

---

### POST /vet/me/photo

Returns a presigned S3 URL for vet profile photo upload.

**Request body:**
```json
{ "contentType": "image/jpeg" }
```

**Response 200:**
```json
{
  "uploadUrl": "https://...",
  "photoUrl": "https://furcircle-dog-photos-prod.s3.amazonaws.com/vets/uuid/profile.jpg",
  "expiresIn": 300
}
```

---

### GET /vet/dashboard

Single call that gives the vet a summary of what needs their attention.

**Response 200:**
```json
{
  "pendingAssessments": {
    "count": 3,
    "oldest": "2026-04-13T09:00:00Z"
  },
  "todaysBookings": [
    {
      "bookingId": "uuid",
      "ownerName": "Joshua Smith",
      "dogName": "Buddy",
      "breed": "Golden Retriever",
      "duration": 30,
      "scheduledAt": "2026-04-15T10:00:00Z",
      "status": "upcoming"
    }
  ],
  "openThreads": {
    "count": 5,
    "unrespondedCount": 2
  }
}
```

---

### GET /vet/assessments

List assessments in the vet's queue.

**Query params:**
- `status` (optional): `pending` / `approved` / `rejected` — defaults to `pending`
- `limit` (optional): default 20

**Response 200:**
```json
{
  "assessments": [
    {
      "assessmentId": "uuid",
      "owner": {
        "firstName": "Joshua",
        "lastName": "Smith"
      },
      "dog": {
        "dogId": "dog-uuid",
        "name": "Buddy",
        "breed": "Golden Retriever",
        "ageMonths": 3
      },
      "description": "Buddy has been showing signs of separation anxiety...",
      "mediaUrls": ["https://..."],
      "status": "pending",
      "createdAt": "2026-04-15T10:00:00Z",
      "hoursOld": 6
    }
  ]
}
```

---

### GET /vet/assessments/{assessmentId}

Full assessment detail including the owner's dog profile — so the vet has full context.

**Response 200:**
```json
{
  "assessmentId": "uuid",
  "owner": {
    "userId": "uuid",
    "firstName": "Joshua",
    "lastName": "Smith",
    "email": "joshua@example.com"
  },
  "dog": {
    "dogId": "uuid",
    "name": "Buddy",
    "breed": "Golden Retriever",
    "ageMonths": 3,
    "spayedNeutered": "not_yet",
    "medicalConditions": "None known",
    "additionalNotes": "On puppy food",
    "environment": "Apartment, no other pets",
    "wellnessScore": 72,
    "currentPlan": {
      "month": "2026-04",
      "whatToExpect": "...",
      "whatToDo": [...]
    },
    "healthRecords": [...]
  },
  "description": "Buddy has been showing signs of separation anxiety...",
  "mediaUrls": ["https://..."],
  "status": "pending",
  "vetResponse": null,
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### PUT /vet/assessments/{assessmentId}/respond

Approve or reject an assessment with a written response.

**Request body:**
```json
{
  "decision": "approved",
  "response": "Thanks for the detailed description. I can see this is classic separation anxiety triggered by the recent move. I'd be happy to work with you and Buddy on a structured desensitisation programme."
}
```

**Validation:**
- `decision`: required, `approved` or `rejected`
- `response`: required, min 50 chars

**Lambda actions:**
1. Update assessment: `status=${decision}, vetResponse=${response}, reviewedAt=now`
2. Send push notification to owner:
   - If approved: "Your assessment has been reviewed ✅ You can now book a consultation with Dr. Emma Clarke"
   - If rejected: "Dr. Emma Clarke has reviewed your assessment and left a response."
3. Write notification record for owner

**Response 200:**
```json
{
  "assessmentId": "uuid",
  "status": "approved",
  "response": "Thanks for the detailed description...",
  "reviewedAt": "2026-04-16T09:00:00Z"
}
```

---

### GET /vet/availability

Get the vet's availability for a date range.

**Query params:**
- `startDate` (required): `yyyy-mm-dd`
- `endDate` (required): `yyyy-mm-dd` (max 30-day window)

**Response 200:**
```json
{
  "vetId": "vet-uuid",
  "availability": [
    {
      "date": "2026-04-18",
      "slots": [
        { "time": "09:00", "duration": [15, 30], "available": true },
        { "time": "09:30", "duration": [15, 30], "available": false },
        { "time": "10:00", "duration": [15, 30], "available": true }
      ]
    }
  ]
}
```

---

### PUT /vet/availability/{date}

Set or replace availability for a specific date.

**Request body:**
```json
{
  "slots": [
    { "time": "09:00", "duration": [15, 30], "available": true },
    { "time": "09:30", "duration": [15, 30], "available": true },
    { "time": "10:00", "duration": [15, 30], "available": true },
    { "time": "10:30", "duration": [15], "available": true }
  ]
}
```

**Validation:**
- `date` must be today or future (cannot set past availability)
- Times must be on 30-minute boundaries (09:00, 09:30, 10:00...)
- Cannot modify a slot that already has a booking — only free slots can be changed

**Response 200:**
```json
{
  "date": "2026-04-18",
  "slots": [...]
}
```

---

### PUT /vet/availability

Bulk set availability for multiple dates (e.g. set a recurring weekly schedule).

**Request body:**
```json
{
  "dates": [
    {
      "date": "2026-04-21",
      "slots": [
        { "time": "09:00", "duration": [15, 30], "available": true },
        { "time": "09:30", "duration": [15, 30], "available": true }
      ]
    },
    {
      "date": "2026-04-22",
      "slots": []
    }
  ]
}
```

**Validation:** Max 30 dates per request. Same slot protection as single-date endpoint.

**Response 200:**
```json
{
  "updated": 2,
  "skipped": 0
}
```

---

### GET /vet/bookings

List the vet's bookings.

**Query params:**
- `status` (optional): `upcoming` / `completed` / `cancelled` — defaults to `upcoming`
- `limit` (optional): default 20

**Response 200:**
```json
{
  "bookings": [
    {
      "bookingId": "uuid",
      "owner": {
        "userId": "uuid",
        "firstName": "Joshua",
        "lastName": "Smith"
      },
      "dog": {
        "dogId": "uuid",
        "name": "Buddy",
        "breed": "Golden Retriever",
        "ageMonths": 3,
        "photoUrl": "https://..."
      },
      "duration": 30,
      "scheduledAt": "2026-04-18T10:00:00Z",
      "status": "upcoming",
      "agoraChannelId": "furcircle-booking-uuid",
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### GET /vet/bookings/{bookingId}

Full booking detail — includes dog's full profile and current wellness plan for call preparation.

**Response 200:**
```json
{
  "bookingId": "uuid",
  "owner": {
    "userId": "uuid",
    "firstName": "Joshua",
    "lastName": "Smith",
    "email": "joshua@example.com"
  },
  "dog": {
    "dogId": "uuid",
    "name": "Buddy",
    "breed": "Golden Retriever",
    "ageMonths": 3,
    "spayedNeutered": "not_yet",
    "medicalConditions": "None known",
    "wellnessScore": 72,
    "categoryScores": { "trainingBehaviour": 85, ... },
    "currentPlan": { ... },
    "healthRecords": [ ... ]
  },
  "assessment": {
    "assessmentId": "uuid",
    "description": "Buddy has been showing signs...",
    "vetResponse": "Thanks for the detailed description..."
  },
  "duration": 30,
  "scheduledAt": "2026-04-18T10:00:00Z",
  "status": "upcoming",
  "agoraChannelId": "furcircle-booking-uuid",
  "postCallSummary": null,
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### GET /vet/bookings/{bookingId}/token

Same logic as owner-side token generation. Returns Agora RTC token for the vet.

**Response 200:** Same shape as `GET /bookings/{bookingId}/token`.

---

### POST /vet/bookings/{bookingId}/summary

Submit post-call notes after a consultation. Triggers the 7-day follow-up thread.

**Request body:**
```json
{
  "summary": "We worked on desensitisation exercises for Buddy's separation anxiety. Key findings: anxiety appears to be triggered by pre-departure cues (picking up keys, putting on shoes). Action plan attached.",
  "actionPlan": [
    "Practice departure cues 5x daily without actually leaving",
    "Gradually increase alone time from 30 seconds to 5 minutes over 2 weeks",
    "Use a stuffed Kong when leaving to create positive association"
  ]
}
```

**Validation:**
- Booking must be `status=upcoming` or `status=completed` (vet may submit summary after call ends)
- `summary`: required, min 100 chars
- `actionPlan`: optional list, max 10 items

**Lambda actions:**
1. Update booking: `status=completed, postCallSummary=${summary}`
2. Write health record to dog profile: `DOG#${dogId} / HEALTH#consultation#${bookingId}`
3. Call `createPostBookingThread` internally (creates 7-day follow-up thread)
4. Send push notification to owner: "Your consultation summary is ready 🐾 Dr. Emma has left notes for Buddy."

**Response 200:**
```json
{
  "bookingId": "uuid",
  "status": "completed",
  "summary": "We worked on desensitisation exercises...",
  "actionPlan": [...],
  "followUpThreadId": "thread-uuid",
  "submittedAt": "2026-04-18T10:45:00Z"
}
```

---

### GET /vet/threads

List all message threads for the vet.

**Query params:**
- `status` (optional): `open` / `closed` — defaults to `open`
- `type` (optional): `ask_a_vet` / `post_booking`
- `limit` (optional): default 20

**Response 200:**
```json
{
  "threads": [
    {
      "threadId": "uuid",
      "type": "ask_a_vet",
      "status": "open",
      "owner": {
        "userId": "uuid",
        "firstName": "Joshua",
        "lastName": "Smith"
      },
      "dog": {
        "dogId": "uuid",
        "name": "Buddy",
        "breed": "Golden Retriever",
        "ageMonths": 3
      },
      "lastMessage": {
        "body": "Should I be worried about it getting worse?",
        "senderType": "owner",
        "createdAt": "2026-04-15T10:10:00Z"
      },
      "unreadCount": 1,
      "isPriority": true,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

`isPriority: true` when the owner's plan is `protector` or `proactive`.

---

### GET /vet/threads/{threadId}

Full thread detail including dog profile for context.

**Response 200:**
```json
{
  "threadId": "uuid",
  "type": "ask_a_vet",
  "status": "open",
  "owner": {
    "userId": "uuid",
    "firstName": "Joshua",
    "lastName": "Smith",
    "subscription": { "plan": "proactive" }
  },
  "dog": {
    "dogId": "uuid",
    "name": "Buddy",
    "breed": "Golden Retriever",
    "ageMonths": 3,
    "wellnessScore": 72,
    "currentPlan": { "whatToExpect": "...", "whatToDo": [...] },
    "healthRecords": [...]
  },
  "messages": [
    {
      "messageId": "uuid",
      "senderType": "owner",
      "senderName": "Joshua",
      "body": "Hi Buddy has been mouthing a lot more this week...",
      "readAt": "2026-04-15T10:03:00Z",
      "createdAt": "2026-04-15T10:00:00Z"
    },
    {
      "messageId": "uuid",
      "senderType": "vet",
      "senderName": "Dr. Sarah Mitchell",
      "body": "Hi Joshua! Yes, increased mouthing at 3 months is completely normal...",
      "readAt": null,
      "createdAt": "2026-04-15T10:05:00Z"
    }
  ],
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### POST /vet/threads/{threadId}/messages

Vet replies to a message thread.

**Request body:**
```json
{
  "body": "Hi Joshua! Yes, increased mouthing at 3 months is completely normal — Buddy is exploring the world with his mouth."
}
```

**Validation:**
- Thread must be assigned to this vet
- Thread must be `status=open`
- `body`: 1–2000 chars

**Lambda actions:**
1. Write message record
2. Send push notification to owner: "Dr. Sarah replied to your message about Buddy"
3. Write notification record for owner

**Response 201:** Message object (same shape as owner's `POST /threads/{threadId}/messages`).

---

### PUT /vet/threads/{threadId}/close

Manually close a thread (vet decides conversation is resolved).

**Lambda actions:**
1. Update thread `status=closed, closedAt=now`
2. Send push notification to owner: "Dr. Sarah has closed your thread. It's saved to Buddy's profile permanently."

**Response 200:**
```json
{
  "threadId": "uuid",
  "status": "closed",
  "closedAt": "2026-04-15T11:00:00Z"
}
```

---

### PUT /vet/threads/{threadId}/read

Mark all owner messages in thread as read by the vet.

**Response 200:**
```json
{
  "threadId": "uuid",
  "markedRead": 3
}
```

---

### GET /vet/notifications

List vet's notifications, newest first.

**Query params:**
- `unreadOnly` (optional): boolean, default false
- `limit` (optional): default 30

**Response 200:**
```json
{
  "notifications": [
    {
      "notificationId": "uuid",
      "type": "new_assessment",
      "title": "New assessment from Joshua",
      "body": "About Buddy (Golden Retriever, 3 months)",
      "read": false,
      "data": {
        "assessmentId": "uuid",
        "dogName": "Buddy"
      },
      "createdAt": "2026-04-15T10:00:00Z"
    },
    {
      "notificationId": "uuid",
      "type": "new_booking",
      "title": "New booking confirmed",
      "body": "Joshua Smith — April 18 at 10:00 AM (30 min)",
      "read": false,
      "data": {
        "bookingId": "uuid"
      },
      "createdAt": "2026-04-15T10:30:00Z"
    }
  ],
  "unreadCount": 2
}
```

---

### PUT /vet/notifications/{notificationId}/read

Mark a single notification as read.

**Response 200:**
```json
{ "notificationId": "uuid", "read": true }
```

---

## Vet Notification Types

| type                    | Trigger                                       |
|-------------------------|-----------------------------------------------|
| `new_assessment`        | Owner submits assessment                      |
| `new_booking`           | Owner creates booking                         |
| `booking_cancelled`     | Owner cancels booking                         |
| `new_thread_message`    | Owner sends message in any thread             |
| `new_ask_a_vet`         | Owner creates new Ask a Vet thread            |

---

## IAM Permissions (Phase 5)

| Lambda                    | DynamoDB                             | SSM      | SNS     | S3        |
|---------------------------|--------------------------------------|----------|---------|-----------|
| vetGetProfile             | GetItem                              | —        | —       | —         |
| vetUpdateProfile          | UpdateItem                           | —        | —       | —         |
| vetUploadPhotoUrl         | GetItem                              | —        | —       | PutObject |
| vetGetDashboard           | GetItem, Query (x3)                  | —        | —       | —         |
| vetListAssessments        | Query (GSI2)                         | —        | —       | —         |
| vetGetAssessment          | GetItem (x3), Query                  | —        | —       | —         |
| vetRespondToAssessment    | GetItem, UpdateItem                  | —        | Publish | —         |
| vetGetAvailability        | Query                                | —        | —       | —         |
| vetSetAvailability        | GetItem, PutItem                     | —        | —       | —         |
| vetBulkSetAvailability    | GetItem (batch), PutItem (batch)     | —        | —       | —         |
| vetListBookings           | Query (GSI2)                         | —        | —       | —         |
| vetGetBooking             | GetItem (x4), Query                  | —        | —       | —         |
| vetGetAgoraToken          | GetItem                              | GetParam | —       | —         |
| vetSubmitPostCallSummary  | GetItem, UpdateItem, PutItem (x2)    | —        | Publish | —         |
| vetListThreads            | Query (GSI2), BatchGetItem           | —        | —       | —         |
| vetGetThread              | GetItem (x3), Query                  | —        | —       | —         |
| vetSendMessage            | GetItem, PutItem                     | —        | Publish | —         |
| vetCloseThread            | GetItem, UpdateItem                  | —        | Publish | —         |
| vetMarkThreadRead         | Query, BatchWrite                    | —        | —       | —         |
| vetGetNotifications       | Query                                | —        | —       | —         |
| vetMarkNotificationRead   | UpdateItem                           | —        | —       | —         |

---

## Open Questions

- [ ] Vet onboarding — admin creates vet accounts manually for now. When does self-signup flow get built?
- [ ] Vet rating system — how are ratings collected? Post-call rating prompt to owner after follow-up thread closes? (Recommend: yes, prompt owner 24h after thread closes, 1–5 stars)
- [ ] Can a vet reject a booking (not just an assessment)? e.g. they fall ill? (Recommend: yes, vet can cancel upcoming booking — full credit refund to owner regardless of timing)
- [ ] Do vets see all owners' past consultation history with other vets, or only their own? (Recommend: only their own — privacy default)
- [ ] Post-call summary — should the `actionPlan` items be trackable tasks on the owner's home screen, or just informational text?
