# FurCircle — Phase 4 Spec: Booking System

## Scope

The most complex phase. Covers:
- Stripe subscription management (create customer, subscribe, webhooks, credit top-up)
- Provider listing (behaviourists, nutritionists) with assessment status
- Assessment submission (required before first behaviourist booking)
- Booking creation (credit check, deduction, Agora channel)
- Booking management (list upcoming/past, cancel)
- Agora token generation for video call
- Post-call summary submission by vet (triggers 7-day follow-up thread)

Depends on: Phase 1 (auth), Phase 3 (messaging — post-booking thread creation).

---

## Subscription Plans

| Plan key    | Display name       | Price     | Credits/month | Ask a Vet         |
|-------------|-------------------|-----------|---------------|-------------------|
| `welcome`   | The Welcome Plan  | Free      | 0             | 1/month           |
| `protector` | The Protector     | $19/month | 0             | Unlimited         |
| `proactive` | The Proactive Parent | $38/month | 70/month   | Unlimited         |

**Credit cost for bookings:**
- 15-minute consultation: 15 credits
- 30-minute consultation: 30 credits

**Behaviourist booking requires:** assessment approved + Standard/Proactive plan (Protector gets free assessment but cannot book video — must upgrade to Proactive)

Wait — re-reading the workflow: "Starter? → Upgrade bottom sheet → must upgrade first" and "Standard / Premium → proceed". Cross-referencing with screenshot plans, the booking gate is:
- `welcome` or `protector`: cannot book video consultations (show upgrade sheet)
- `proactive`: can book (has 70 credits/month)

---

## AWS Resources

### Stripe

| Resource             | Purpose                                               |
|----------------------|-------------------------------------------------------|
| Stripe Customer      | Created when owner first visits subscription page     |
| Stripe Subscription  | Created when owner selects a paid plan                |
| Stripe Webhook       | `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed` |
| Stripe Checkout / Payment Intent | Credit top-up (one-time payment)       |

Stripe webhook endpoint: `POST /webhooks/stripe` (no Cognito auth — verified via Stripe signature).

### Agora

| Resource       | Purpose                                           |
|----------------|---------------------------------------------------|
| Agora App ID   | Stored in SSM Parameter Store: `/furcircle/agora/appId` |
| Agora App Certificate | SSM: `/furcircle/agora/appCertificate`   |
| Channel naming | `furcircle-booking-${bookingId}`                 |
| Token expiry   | 3600 seconds (1 hour) from scheduled call time   |

Agora tokens generated server-side using `agora-token` npm package.

### SSM Parameter Store

```
/furcircle/{stage}/stripe/secretKey         (SecureString)
/furcircle/{stage}/stripe/webhookSecret     (SecureString)
/furcircle/{stage}/agora/appId              (String)
/furcircle/{stage}/agora/appCertificate     (SecureString)
/furcircle/{stage}/anthropic/apiKey         (SecureString)
```

---

## Lambda Functions

| Function                    | Trigger                                   | Purpose                                              |
|-----------------------------|-------------------------------------------|------------------------------------------------------|
| `getSubscriptionPlans`      | GET /subscriptions/plans                  | Return available plans (public)                      |
| `createStripeCustomer`      | POST /subscriptions/customer              | Create Stripe customer for owner                     |
| `subscribeToPlan`           | POST /subscriptions                       | Subscribe owner to a paid plan                       |
| `cancelSubscription`        | DELETE /subscriptions                     | Cancel current subscription                          |
| `topUpCredits`              | POST /subscriptions/credits/topup         | One-time credit purchase                             |
| `stripeWebhook`             | POST /webhooks/stripe                     | Handle Stripe events (subscription updates, payments)|
| `listProviders`             | GET /providers                            | List vets by type with assessment status             |
| `getProvider`               | GET /providers/{vetId}                    | Get single provider profile                          |
| `submitAssessment`          | POST /assessments                         | Submit behaviourist assessment                       |
| `getAssessment`             | GET /assessments/{assessmentId}           | Get assessment status + vet response                 |
| `getProviderAssessment`     | GET /providers/{vetId}/assessment         | Check if owner has assessment with a specific vet    |
| `getProviderAvailability`   | GET /providers/{vetId}/availability       | Get available slots for date range                   |
| `createBooking`             | POST /bookings                            | Deduct credits and create booking                    |
| `listBookings`              | GET /bookings                             | List owner's upcoming and past bookings              |
| `getBooking`                | GET /bookings/{bookingId}                 | Get booking details                                  |
| `cancelBooking`             | DELETE /bookings/{bookingId}              | Cancel upcoming booking (refund credits if > 24h)    |
| `getAgoraToken`             | GET /bookings/{bookingId}/token           | Generate Agora token for video call                  |

---

## API Endpoints

### GET /subscriptions/plans

Public endpoint — no auth required. Returns the plan catalogue.

**Response 200:**
```json
{
  "plans": [
    {
      "key": "welcome",
      "name": "The Welcome Plan",
      "price": 0,
      "currency": "usd",
      "interval": null,
      "credits": 0,
      "features": [
        "AI-powered personalised monthly wellness roadmap",
        "Ask a Vet once a month",
        "Basic milestone tracking"
      ],
      "stripePriceId": null
    },
    {
      "key": "protector",
      "name": "The Protector",
      "price": 1900,
      "currency": "usd",
      "interval": "month",
      "credits": 0,
      "features": [
        "Everything in The Welcome Plan",
        "Unlimited Ask a Vet with priority response",
        "Free behaviour assessment",
        "Curated training video library",
        "Daily wellness nudges"
      ],
      "stripePriceId": "price_xxx",
      "badge": null
    },
    {
      "key": "proactive",
      "name": "The Proactive Parent",
      "price": 3800,
      "currency": "usd",
      "interval": "month",
      "credits": 70,
      "features": [
        "Everything in The Protector",
        "70 credits/month for video consultations",
        "Monthly AI wellness report",
        "Priority booking",
        "Early access to new features",
        "Partner discounts on premium food & care"
      ],
      "stripePriceId": "price_xxx",
      "badge": "Most Popular"
    }
  ]
}
```

---

### POST /subscriptions/customer

Creates a Stripe customer and saves `stripeCustomerId` to DynamoDB. Idempotent — if customer already exists, returns existing.

**Request body:** none (uses authenticated owner's email)

**Response 200:**
```json
{
  "stripeCustomerId": "cus_xxx"
}
```

---

### POST /subscriptions

Subscribe owner to a plan. Requires Stripe customer to exist first.

**Request body:**
```json
{
  "planKey": "proactive",
  "paymentMethodId": "pm_xxx"
}
```

**Lambda actions:**
1. Get owner's subscription record from DynamoDB
2. Attach payment method to Stripe customer
3. Create Stripe Subscription with `stripePriceId` for plan
4. On success: update DynamoDB subscription record with `plan, stripeSubscriptionId, status=active, currentPeriodEnd`
5. If upgrading from `welcome`/`protector` to `proactive`: set `creditBalance = 70` (first month credits)

**Response 200:**
```json
{
  "plan": "proactive",
  "creditBalance": 70,
  "status": "active",
  "currentPeriodEnd": "2026-05-15T00:00:00Z"
}
```

---

### DELETE /subscriptions

Cancel at period end (not immediately).

**Lambda actions:**
1. Call Stripe: `stripe.subscriptions.update(id, { cancel_at_period_end: true })`
2. Update DynamoDB: `status=cancelling`

**Response 200:**
```json
{
  "status": "cancelling",
  "cancelsAt": "2026-05-15T00:00:00Z"
}
```

---

### POST /subscriptions/credits/topup

One-time credit purchase outside of monthly subscription.

**Request body:**
```json
{
  "credits": 20,
  "paymentMethodId": "pm_xxx"
}
```

**Credit packages** (hardcoded, not user-configurable):

| Credits | Price    |
|---------|----------|
| 10      | $10.00   |
| 20      | $18.00   |
| 50      | $40.00   |

**Lambda actions:**
1. Validate `credits` is one of `10, 20, 50`
2. Create Stripe PaymentIntent for corresponding amount
3. Confirm payment
4. On success: `ADD creditBalance :credits` on DynamoDB subscription record

**Response 200:**
```json
{
  "creditBalance": 90,
  "creditsAdded": 20
}
```

---

### POST /webhooks/stripe

No Cognito auth. Verified using `stripe-signature` header + webhook secret from SSM.

**Handled events:**

| Event                             | Action                                                   |
|-----------------------------------|----------------------------------------------------------|
| `invoice.payment_succeeded`       | Add monthly credits to owner's balance (for `proactive`) |
| `invoice.payment_failed`          | Set `status=past_due`, send push notification            |
| `customer.subscription.updated`   | Sync plan, status, and `currentPeriodEnd` to DynamoDB    |
| `customer.subscription.deleted`   | Downgrade to `welcome`, clear credits                    |

**Monthly credit top-up logic (invoice.payment_succeeded):**
1. Find owner by `stripeCustomerId` (scan or GSI lookup)
2. If plan is `proactive`: set `creditBalance = 70` (reset, not add — unused credits don't roll over)
3. Log credit refresh to notifications

**Response:** Always `200 {}` to acknowledge Stripe. Handle processing errors internally with logging.

---

### GET /providers

List providers by type, with the authenticated owner's assessment status for each.

**Query params:**
- `type` (required): `behaviourist` or `nutritionist`

**Response 200:**
```json
{
  "providers": [
    {
      "vetId": "vet-uuid",
      "firstName": "Emma",
      "lastName": "Clarke",
      "providerType": "behaviourist",
      "specialisation": "Puppy behaviour & early socialisation",
      "photoUrl": "https://...",
      "rating": 4.9,
      "reviewCount": 71,
      "isActive": true,
      "assessmentStatus": "none",
      "canBook": false
    },
    {
      "vetId": "vet-uuid-2",
      "firstName": "James",
      "lastName": "Whitfield",
      "providerType": "behaviourist",
      "specialisation": "Anxiety, aggression & reactive dogs",
      "photoUrl": "https://...",
      "rating": 4.8,
      "reviewCount": 134,
      "isActive": true,
      "assessmentStatus": "approved",
      "canBook": true
    }
  ]
}
```

**`assessmentStatus` values:**
- `none` — no assessment submitted → show "Free Assessment" CTA
- `pending` — assessment submitted, awaiting vet review
- `approved` — vet approved → show "Book Consultation" CTA (if plan allows)
- `rejected` — vet rejected

**`canBook`:**
- `true` if `assessmentStatus=approved` AND owner's plan is `proactive`
- For `nutritionist`: always `canBook=true` if plan is `proactive` (no assessment required)

**Logic:**
1. Query `GSI3: GSI3PK=PROVIDER_TYPE#behaviourist` (sorted by rating DESC)
2. For each vet, check if owner has an assessment: `GSI1: OWNER#${ownerId}, ASSESSMENT#${vetId}`
3. Check subscription plan for `canBook`

---

### GET /providers/{vetId}

Single provider detail.

**Response 200:** Same shape as a single item in `GET /providers`, plus:
```json
{
  "bio": "Dr. Emma Clarke has 8 years experience with puppy development...",
  "availability": {
    "nextAvailable": "2026-04-18"
  }
}
```

---

### GET /providers/{vetId}/availability

Get available booking slots.

**Query params:**
- `startDate` (required): `yyyy-mm-dd`
- `endDate` (required): `yyyy-mm-dd` (max 14-day window)

**Response 200:**
```json
{
  "vetId": "vet-uuid",
  "availability": [
    {
      "date": "2026-04-18",
      "slots": [
        { "time": "10:00", "duration": [15, 30], "available": true },
        { "time": "10:30", "duration": [15, 30], "available": false },
        { "time": "11:00", "duration": [15], "available": true }
      ]
    },
    {
      "date": "2026-04-19",
      "slots": []
    }
  ]
}
```

---

### POST /assessments

Submit a free assessment to a behaviourist.

**Request body (multipart or JSON with pre-uploaded S3 keys):**
```json
{
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "description": "Buddy has been showing signs of separation anxiety since we moved apartments...",
  "mediaUrls": [
    "https://furcircle-dog-photos-prod.s3.amazonaws.com/assessments/uuid/video1.mp4"
  ]
}
```

**Validation:**
- One pending/approved assessment per owner per vet (prevent duplicates)
- `description`: required, min 50 chars
- `mediaUrls`: optional, max 3 items, each must be an S3 URL under `assessments/` path

**Lambda actions:**
1. Check for existing assessment (not rejected) for this owner+vet combo
2. Write `ASSESSMENT#${assessmentId}` record with `status=pending`
3. Send push notification to vet: "New assessment from Joshua about Buddy"

**Response 201:**
```json
{
  "assessmentId": "uuid",
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "status": "pending",
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### GET /assessments/{assessmentId}

Get assessment status and vet response.

**Response 200:**
```json
{
  "assessmentId": "uuid",
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "status": "approved",
  "description": "Buddy has been showing signs...",
  "mediaUrls": ["https://..."],
  "vetResponse": "Thanks for the detailed description. I can see this is classic separation anxiety...",
  "createdAt": "2026-04-15T10:00:00Z",
  "reviewedAt": "2026-04-16T09:00:00Z"
}
```

---

### POST /bookings

Create a booking. Credits are deducted atomically.

**Request body:**
```json
{
  "vetId": "vet-uuid",
  "dogId": "dog-uuid",
  "assessmentId": "assessment-uuid",
  "duration": 30,
  "scheduledAt": "2026-04-18T10:00:00Z"
}
```

**Validation:**
- `duration`: 15 or 30
- `scheduledAt`: must be a future datetime, must match an available slot
- For `behaviourist`: `assessmentId` required and must be `status=approved`
- Owner plan must be `proactive`
- Credit balance must be ≥ duration (15 or 30 credits)

**Lambda actions (atomic credit deduction):**
1. Read subscription: check plan + credit balance
2. Check slot is still available (re-read vet availability)
3. Use DynamoDB ConditionExpression to deduct credits atomically:
   ```
   UpdateItem on OWNER#${ownerId}/SUBSCRIPTION
   SET creditBalance = creditBalance - :cost
   CONDITION creditBalance >= :cost
   ```
   If condition fails: return 402 `INSUFFICIENT_CREDITS`
4. Mark slot as unavailable in vet's availability record
5. Generate Agora channel ID: `furcircle-booking-${bookingId}`
6. Write `BOOKING#${bookingId}` record
7. Send push notification to vet: "New booking from Joshua — April 18 at 10:00 AM"
8. Send push notification to owner: "Booking confirmed with Dr. Emma Clarke 🎉"

**Response 201:**
```json
{
  "bookingId": "uuid",
  "vetId": "vet-uuid",
  "vet": {
    "firstName": "Emma",
    "lastName": "Clarke",
    "providerType": "behaviourist",
    "photoUrl": "https://..."
  },
  "dogId": "dog-uuid",
  "duration": 30,
  "scheduledAt": "2026-04-18T10:00:00Z",
  "status": "upcoming",
  "creditsDeducted": 30,
  "creditBalance": 40,
  "agoraChannelId": "furcircle-booking-uuid",
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### GET /bookings

List owner's bookings.

**Query params:**
- `status` (optional): `upcoming` or `past` (maps to `upcoming` and `completed+cancelled`)
- `limit` (optional): default 20

**Response 200:**
```json
{
  "bookings": [
    {
      "bookingId": "uuid",
      "vet": {
        "vetId": "vet-uuid",
        "firstName": "Emma",
        "lastName": "Clarke",
        "providerType": "behaviourist",
        "photoUrl": "https://"
      },
      "dog": {
        "dogId": "dog-uuid",
        "name": "Buddy"
      },
      "duration": 30,
      "scheduledAt": "2026-04-18T10:00:00Z",
      "status": "upcoming",
      "creditsDeducted": 30,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### GET /bookings/{bookingId}

Single booking detail.

**Response 200:** Full booking object including `agoraChannelId` and `postCallSummary` (if completed).

---

### DELETE /bookings/{bookingId}

Cancel an upcoming booking.

**Cancellation policy:**
- Cancel > 24h before scheduled time → full credit refund
- Cancel ≤ 24h before scheduled time → no refund

**Lambda actions:**
1. Verify booking belongs to owner and is `status=upcoming`
2. Check cancellation window
3. Update booking `status=cancelled`
4. If refund eligible: `ADD creditBalance :cost` on subscription record
5. Restore vet availability slot
6. Send push notification to vet: "Joshua cancelled their April 18 booking"

**Response 200:**
```json
{
  "bookingId": "uuid",
  "status": "cancelled",
  "creditsRefunded": 30,
  "creditBalance": 70
}
```

---

### GET /bookings/{bookingId}/token

Generate a short-lived Agora RTC token for joining the video call.

**Auth check:** User must be either the booking owner or the assigned vet.

**Lambda actions:**
1. Verify booking exists and user is owner or vet
2. Verify booking is `status=upcoming` and `scheduledAt` is within ±30 minutes of now
3. Read Agora App ID + Certificate from SSM
4. Generate RTC token using `agora-token` package:
   - Channel: `agoraChannelId`
   - UID: deterministic from userId (hash to uint32)
   - Role: publisher
   - Expiry: 3600 seconds

**Response 200:**
```json
{
  "token": "006xxx...",
  "channelId": "furcircle-booking-uuid",
  "uid": 123456789,
  "appId": "xxx",
  "expiresAt": "2026-04-18T11:00:00Z"
}
```

**Error:** 403 if called more than 30 minutes before scheduled time (too early to join).

---

## Post-Call Flow (Vet-initiated, in Phase 5)

When a vet submits the post-call summary (via Phase 5 vet API):
1. Update booking: `status=completed, postCallSummary=${summary}`
2. Save consultation record to dog health profile: `DOG#${dogId} / HEALTH#consultation#${bookingId}`
3. Call `createPostBookingThread` (Phase 3) to open 7-day follow-up thread
4. Send push notification to owner: "Your consultation summary is ready. Dr. Emma has left notes for Buddy."

---

## IAM Permissions (Phase 4)

| Lambda                  | DynamoDB                              | SSM        | SNS     |
|-------------------------|---------------------------------------|------------|---------|
| getSubscriptionPlans    | —                                     | —          | —       |
| createStripeCustomer    | UpdateItem                            | GetParam   | —       |
| subscribeToPlan         | UpdateItem                            | GetParam   | —       |
| cancelSubscription      | UpdateItem                            | GetParam   | —       |
| topUpCredits            | UpdateItem                            | GetParam   | —       |
| stripeWebhook           | Query (GSI), UpdateItem               | GetParam   | Publish |
| listProviders           | Query (GSI3), BatchGetItem, Query     | —          | —       |
| getProvider             | GetItem, Query                        | —          | —       |
| getProviderAvailability | GetItem                               | —          | —       |
| submitAssessment        | Query, PutItem                        | —          | Publish |
| getAssessment           | GetItem                               | —          | —       |
| createBooking           | GetItem, UpdateItem (conditional), PutItem | GetParam | Publish |
| listBookings            | Query (GSI1)                          | —          | —       |
| getBooking              | GetItem                               | —          | —       |
| cancelBooking           | GetItem, UpdateItem (x2)              | —          | Publish |
| getAgoraToken           | GetItem                               | GetParam   | —       |

---

## Open Questions

- [ ] Credits roll over month to month, or reset on billing renewal? (Recommend: reset — simpler, aligns with Stripe invoice cycle)
- [ ] What happens to active bookings if a user downgrades from `proactive` to `protector`? (Recommend: existing bookings complete as normal, no new bookings until they upgrade)
- [ ] Is the assessment a one-time thing per behaviourist forever, or does it reset after 6/12 months? (Recommend: one-time per owner+vet pair, vet can initiate a re-assessment if needed)
- [ ] Stripe: use Payment Intents API (credit top-up) or Stripe Checkout (redirect flow)? Mobile usually prefers Payment Intents for in-app payment sheets.
- [ ] Agora: does the 30-minute join window need to be configurable, or is ±30 minutes fine for MVP?
