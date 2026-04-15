# FurCircle — DynamoDB Single-Table Design

Designed once, upfront, to support all phases. Changing a single-table design after Lambdas are
built is expensive. Every access pattern is listed here before any code is written.

---

## Table Config

| Property      | Value           |
|---------------|-----------------|
| Table name    | `furcircle`     |
| Partition key | `PK` (String)   |
| Sort key      | `SK` (String)   |
| Billing       | PAY_PER_REQUEST |
| Region        | us-east-1       |

### Global Secondary Indexes

| Index   | PK        | SK        | Purpose                                              |
|---------|-----------|-----------|------------------------------------------------------|
| `GSI1`  | `GSI1PK`  | `GSI1SK`  | Owner → dogs, bookings, threads, notifications       |
| `GSI2`  | `GSI2PK`  | `GSI2SK`  | Vet → bookings, assessments, threads                 |
| `GSI3`  | `GSI3PK`  | `GSI3SK`  | Provider type listing (behaviourist / nutritionist)  |

All GSIs use the same PAY_PER_REQUEST billing as the base table. Project ALL attributes.

---

## Entities

### 1. Owner Profile

Stores owner account data. Created by the Cognito Post Confirmation Lambda trigger.

| Attribute    | Type   | Value                          |
|--------------|--------|--------------------------------|
| PK           | String | `OWNER#${userId}`              |
| SK           | String | `PROFILE`                      |
| GSI1PK       | String | `EMAIL#${email}`               |
| GSI1SK       | String | `OWNER`                        |
| userId       | String | Cognito sub (UUID)             |
| firstName    | String |                                |
| lastName     | String |                                |
| email        | String |                                |
| pushToken    | String | Expo / FCM push token          |
| referralCode | String | Auto-generated on sign-up      |
| referredBy   | String | referralCode of referrer       |
| createdAt    | String | ISO 8601                       |
| updatedAt    | String | ISO 8601                       |

**Access patterns:**
- Get owner by userId → `PK=OWNER#${userId}, SK=PROFILE`
- Get owner by email → `GSI1: GSI1PK=EMAIL#${email}, GSI1SK=OWNER`

---

### 2. Subscription

One record per owner. Created alongside the owner profile (Welcome Plan, 0 credits).

| Attribute            | Type   | Value                                          |
|----------------------|--------|------------------------------------------------|
| PK                   | String | `OWNER#${ownerId}`                             |
| SK                   | String | `SUBSCRIPTION`                                 |
| plan                 | String | `welcome` / `protector` / `proactive`          |
| creditBalance        | Number | Starts at 0                                    |
| stripeCustomerId     | String | Set when Stripe customer is created            |
| stripeSubscriptionId | String | Set on paid plan activation                    |
| status               | String | `active` / `cancelled` / `past_due`           |
| currentPeriodEnd     | String | ISO 8601 — next billing date                  |
| createdAt            | String | ISO 8601                                       |
| updatedAt            | String | ISO 8601                                       |

**Access patterns:**
- Get subscription → `PK=OWNER#${ownerId}, SK=SUBSCRIPTION`

---

### 3. Dog Profile

| Attribute          | Type    | Value                                    |
|--------------------|---------|------------------------------------------|
| PK                 | String  | `DOG#${dogId}`                           |
| SK                 | String  | `PROFILE`                                |
| GSI1PK             | String  | `OWNER#${ownerId}`                       |
| GSI1SK             | String  | `DOG#${dogId}`                           |
| dogId              | String  | UUID                                     |
| ownerId            | String  | Cognito userId                           |
| name               | String  |                                          |
| breed              | String  |                                          |
| ageMonths          | Number  | Age in months at time of registration    |
| dateOfBirth        | String  | Derived from ageMonths at registration   |
| photoUrl           | String  | S3 URL                                   |
| adoptedFromShelter | Boolean |                                          |
| spayedNeutered     | String  | `yes` / `no` / `not_yet`                |
| medicalConditions  | String  | Free text                                |
| additionalNotes    | String  | Free text (medications, diet, etc.)      |
| wellnessScore      | Number  | 0–100, updated monthly                  |
| planStatus         | String  | `generating` / `ready`                  |
| createdAt          | String  | ISO 8601                                 |
| updatedAt          | String  | ISO 8601                                 |

**Access patterns:**
- Get dog by dogId → `PK=DOG#${dogId}, SK=PROFILE`
- List dogs for owner → `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK begins_with DOG#`

---

### 4. Health Record

Multiple records per dog (vaccinations, conditions, etc.).

| Attribute | Type   | Value                                                                  |
|-----------|--------|------------------------------------------------------------------------|
| PK        | String | `DOG#${dogId}`                                                         |
| SK        | String | `HEALTH#${type}#${recordId}` e.g. `HEALTH#vaccination#uuid`           |
| dogId     | String |                                                                        |
| type      | String | `vaccination` / `medical_condition` / `spayed_neutered` / `environment`|
| title     | String | e.g. "Vaccinations"                                                    |
| notes     | String |                                                                        |
| dueDate   | String | ISO 8601 (for vaccinations)                                            |
| createdAt | String | ISO 8601                                                               |
| updatedAt | String | ISO 8601                                                               |

**Access patterns:**
- List health records for dog → `PK=DOG#${dogId}, SK begins_with HEALTH#`
- List by type → `PK=DOG#${dogId}, SK begins_with HEALTH#vaccination#`

---

### 5. AI Monthly Plan

One plan per dog per calendar month. Generated by Claude via Step Function.

| Attribute        | Type   | Value                                                     |
|------------------|--------|-----------------------------------------------------------|
| PK               | String | `DOG#${dogId}`                                            |
| SK               | String | `PLAN#${yyyy}-${mm}` e.g. `PLAN#2026-04`                 |
| GSI1PK           | String | `PLAN#${yyyy}-${mm}`                                      |
| GSI1SK           | String | `DOG#${dogId}`                                            |
| dogId            | String |                                                           |
| month            | String | `2026-04`                                                 |
| ageMonthsAtPlan  | Number | Dog's age when plan was generated                        |
| whatToExpect     | String | Narrative intro for the month                            |
| whatToDo         | List   | `[{ text, videoUrl? }]`                                  |
| whatNotToDo      | List   | `[{ text }]`                                             |
| watchFor         | List   | `[{ text }]`                                             |
| earlyWarningSigns| List   | `[{ text, action }]`                                     |
| comingUpNextMonth| String | Preview of next month                                    |
| milestones       | List   | `[{ emoji, title, description }]` — 3 items             |
| wellnessScore    | Number | 0–100 baseline for this month                           |
| generatedAt      | String | ISO 8601                                                  |

**Access patterns:**
- Get current plan → `PK=DOG#${dogId}, SK=PLAN#2026-04`
- List all plans (history) → `PK=DOG#${dogId}, SK begins_with PLAN#`
- All dogs needing refresh this month → `GSI1: GSI1PK=PLAN#2026-04`

---

### 6. Vet Profile

Created manually (admin operation) or via vet sign-up flow.

| Attribute    | Type   | Value                                          |
|--------------|--------|------------------------------------------------|
| PK           | String | `VET#${vetId}`                                 |
| SK           | String | `PROFILE`                                      |
| GSI1PK       | String | `EMAIL#${email}`                               |
| GSI1SK       | String | `VET`                                          |
| GSI3PK       | String | `PROVIDER_TYPE#${type}` e.g. `PROVIDER_TYPE#behaviourist` |
| GSI3SK       | String | `RATING#${rating}#VET#${vetId}`                |
| vetId        | String | Cognito userId                                 |
| cognitoSub   | String |                                                |
| firstName    | String |                                                |
| lastName     | String |                                                |
| email        | String |                                                |
| providerType | String | `behaviourist` / `nutritionist`                |
| specialisation| String | e.g. "Puppy behaviour & early socialisation"  |
| bio          | String |                                                |
| photoUrl     | String |                                                |
| rating       | Number | e.g. 4.9 (1 decimal place, stored as Number)  |
| reviewCount  | Number |                                                |
| isActive     | Boolean| Whether accepting new clients                  |
| createdAt    | String | ISO 8601                                       |

**Access patterns:**
- Get vet by vetId → `PK=VET#${vetId}, SK=PROFILE`
- List behaviourists by rating → `GSI3: GSI3PK=PROVIDER_TYPE#behaviourist, GSI3SK begins_with RATING#`
- Get vet by email → `GSI1: GSI1PK=EMAIL#${email}, GSI1SK=VET`

---

### 7. Vet Availability

One record per vet per date.

| Attribute | Type   | Value                                                        |
|-----------|--------|--------------------------------------------------------------|
| PK        | String | `VET#${vetId}`                                               |
| SK        | String | `AVAIL#${yyyy}-${mm}-${dd}` e.g. `AVAIL#2026-04-18`        |
| vetId     | String |                                                              |
| date      | String | `2026-04-18`                                                 |
| slots     | List   | `[{ time: "10:00", available: true, duration: [15, 30] }]`  |

**Access patterns:**
- Get vet availability for date range → `PK=VET#${vetId}, SK between AVAIL#2026-04-18 and AVAIL#2026-04-25`

---

### 8. Assessment

Required before first booking with a Behaviourist. Free for Nutritionist (skip to booking).

| Attribute    | Type   | Value                                                  |
|--------------|--------|--------------------------------------------------------|
| PK           | String | `ASSESSMENT#${assessmentId}`                           |
| SK           | String | `ASSESSMENT`                                           |
| GSI1PK       | String | `OWNER#${ownerId}`                                     |
| GSI1SK       | String | `ASSESSMENT#${vetId}`                                  |
| GSI2PK       | String | `VET#${vetId}`                                         |
| GSI2SK       | String | `ASSESSMENT#${status}#${createdAt}`                   |
| assessmentId | String | UUID                                                   |
| ownerId      | String |                                                        |
| vetId        | String |                                                        |
| dogId        | String |                                                        |
| providerType | String | `behaviourist`                                         |
| description  | String | Owner's written description                            |
| mediaUrls    | List   | S3 URLs for photos/video                               |
| status       | String | `pending` / `approved` / `rejected`                   |
| vetResponse  | String | Vet's written response                                 |
| createdAt    | String | ISO 8601                                               |
| reviewedAt   | String | ISO 8601                                               |

**Access patterns:**
- Get owner's assessment for a vet → `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK=ASSESSMENT#${vetId}`
- List pending assessments for vet → `GSI2: GSI2PK=VET#${vetId}, GSI2SK begins_with ASSESSMENT#pending`

---

### 9. Booking

| Attribute       | Type   | Value                                                   |
|-----------------|--------|---------------------------------------------------------|
| PK              | String | `BOOKING#${bookingId}`                                  |
| SK              | String | `BOOKING`                                               |
| GSI1PK          | String | `OWNER#${ownerId}`                                      |
| GSI1SK          | String | `BOOKING#${status}#${scheduledAt}`                     |
| GSI2PK          | String | `VET#${vetId}`                                          |
| GSI2SK          | String | `BOOKING#${status}#${scheduledAt}`                     |
| bookingId       | String | UUID                                                   |
| ownerId         | String |                                                         |
| vetId           | String |                                                         |
| dogId           | String |                                                         |
| assessmentId    | String | Required for behaviourist bookings                      |
| duration        | Number | 15 or 30 (minutes)                                     |
| scheduledAt     | String | ISO 8601                                               |
| status          | String | `upcoming` / `completed` / `cancelled`                 |
| creditsDeducted | Number |                                                         |
| agoraChannelId  | String | Generated at booking time                              |
| postCallSummary | String | Submitted by vet after call                            |
| createdAt       | String | ISO 8601                                               |

**Access patterns:**
- List owner's upcoming bookings → `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK begins_with BOOKING#upcoming`
- List owner's past bookings → `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK begins_with BOOKING#completed`
- List vet's upcoming bookings → `GSI2: GSI2PK=VET#${vetId}, GSI2SK begins_with BOOKING#upcoming`

---

### 10. Message Thread

| Attribute | Type   | Value                                             |
|-----------|--------|---------------------------------------------------|
| PK        | String | `THREAD#${threadId}`                              |
| SK        | String | `METADATA`                                        |
| GSI1PK    | String | `OWNER#${ownerId}`                                |
| GSI1SK    | String | `THREAD#${type}#${createdAt}`                    |
| GSI2PK    | String | `VET#${vetId}`                                    |
| GSI2SK    | String | `THREAD#${status}#${createdAt}`                  |
| threadId  | String | UUID                                              |
| ownerId   | String |                                                   |
| vetId     | String |                                                   |
| dogId     | String |                                                   |
| type      | String | `ask_a_vet` / `post_booking`                     |
| status    | String | `open` / `closed`                                |
| bookingId | String | Set only for `post_booking` threads              |
| createdAt | String | ISO 8601                                          |
| closedAt  | String | ISO 8601 — 7 days after booking completion       |

**Access patterns:**
- List owner's threads → `GSI1: GSI1PK=OWNER#${ownerId}, GSI1SK begins_with THREAD#`
- List open threads for vet → `GSI2: GSI2PK=VET#${vetId}, GSI2SK begins_with THREAD#open`

---

### 11. Message

Messages are stored under the thread's PK, sorted by timestamp.

| Attribute  | Type   | Value                                                   |
|------------|--------|---------------------------------------------------------|
| PK         | String | `THREAD#${threadId}`                                    |
| SK         | String | `MSG#${epochMs}#${messageId}` e.g. `MSG#1744982400000#uuid` |
| messageId  | String | UUID                                                    |
| threadId   | String |                                                         |
| senderId   | String | userId (owner or vet)                                  |
| senderType | String | `owner` / `vet`                                        |
| body       | String |                                                         |
| readAt     | String | ISO 8601 — null until read                             |
| createdAt  | String | ISO 8601                                               |

**Access patterns:**
- List messages in thread → `PK=THREAD#${threadId}, SK begins_with MSG#`
- Paginate (newest last) → scan forward, use LastEvaluatedKey

---

### 12. Notification

| Attribute      | Type    | Value                                              |
|----------------|---------|----------------------------------------------------|
| PK             | String  | `OWNER#${userId}` or `VET#${userId}`               |
| SK             | String  | `NOTIF#${epochMs}#${notificationId}`               |
| notificationId | String  | UUID                                               |
| userId         | String  |                                                    |
| type           | String  | `plan_ready` / `assessment_reviewed` / `booking_confirmed` / `message_received` / `monthly_refresh` |
| title          | String  |                                                    |
| body           | String  |                                                    |
| read           | Boolean |                                                    |
| data           | Map     | Contextual payload (dogId, bookingId, etc.)       |
| createdAt      | String  | ISO 8601                                           |

**Access patterns:**
- List notifications for user (newest first) → `PK=OWNER#${userId}, SK begins_with NOTIF#` (scan reverse)

---

## TTL

No TTL set on any entity by default. Notifications could have a TTL of 90 days if volume becomes a concern (add a `ttl` Number attribute with Unix timestamp).

---

## Key Design Decisions

1. **No hotspot on PK** — every entity uses a UUID-based PK. No fan-out writes to a single partition.
2. **Status embedded in SK for bookings/assessments** — `BOOKING#upcoming#...` lets us filter by status without a FilterExpression, which wastes read capacity.
3. **Rating embedded in GSI3SK for vets** — `RATING#4.9#VET#...` gives us sorted-by-rating listing for free on the GSI scan.
4. **Messages under thread PK** — thread metadata and messages share the same partition. One `Query` retrieves all messages; no join needed.
5. **Plan SK is sortable** — `PLAN#2026-04` sorts chronologically as a string. `begins_with PLAN#` returns full history in order.
