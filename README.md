# FurCircle Backend

AI-powered monthly wellness plans for dog owners. Serverless backend on AWS.

**Stack:** TypeScript · Serverless Framework v4 · AWS Lambda · DynamoDB (single-table) · Cognito · Step Functions · Claude API · S3 · Stripe · Agora

**Base URL:** `https://057mg3hls1.execute-api.us-east-1.amazonaws.com`

---

## Table of Contents

- [Phase 1 — Auth & Onboarding](#phase-1--auth--onboarding)
- [Phase 2 — Home & Wellness](#phase-2--home--wellness)
- [Phase 3 — Messaging](#phase-3--messaging)
- [Phase 4 — Bookings & Subscriptions](#phase-4--bookings--subscriptions)
- [Phase 5 — Vet API](#phase-5--vet-api)
- [Database Design](#database-design)
- [Development](#development)
- [Deploy](#deploy)

---

## Phase 1 — Auth & Onboarding

Owner signup, dog profiles, AI wellness plan generation.

| Resource | Link |
|----------|------|
| Architecture diagram | [`docs/architecture-phase1.excalidraw`](docs/architecture-phase1.excalidraw) — open at [excalidraw.com](https://excalidraw.com) |
| Full spec | [`docs/spec-phase1-auth-onboarding.md`](docs/spec-phase1-auth-onboarding.md) |

**Endpoints:**
- `POST /dogs` — create dog + trigger async AI plan generation
- `GET /dogs` — list owner's dogs
- `GET/PUT /dogs/{dogId}` — get or update dog profile
- `POST /dogs/{dogId}/photo` — presigned S3 upload URL
- `GET /dogs/{dogId}/plan` — AI-generated monthly wellness plan
- `GET/PUT /owners/me` — owner profile

---

## Phase 2 — Home & Wellness

Home feed, activity logging, dog journey timeline.

| Resource | Link |
|----------|------|
| Full spec | [`docs/spec-phase2-home-wellness.md`](docs/spec-phase2-home-wellness.md) |

**Endpoints:**
- `GET /home` — personalised home feed (today's plan, upcoming tasks)
- `GET /dogs/{dogId}/journey` — milestone + health record timeline
- `POST /dogs/{dogId}/activities` — log an activity
- `GET /dogs/{dogId}/activities` — list logged activities

---

## Phase 3 — Messaging

Owner ↔ vet ask-a-vet threads.

| Resource | Link |
|----------|------|
| Full spec | [`docs/spec-phase3-messaging.md`](docs/spec-phase3-messaging.md) |

**Endpoints:**
- `POST /threads` — open a new thread with a vet
- `GET /threads` — list owner's threads
- `GET /threads/{threadId}` — thread detail + messages
- `POST /threads/{threadId}/messages` — send a message
- `PUT /threads/{threadId}/read` — mark messages as read

---

## Phase 4 — Bookings & Subscriptions

Stripe subscriptions, provider discovery, video consultation bookings.

| Resource | Link |
|----------|------|
| Full spec | [`docs/spec-phase4-booking.md`](docs/spec-phase4-booking.md) |

**Endpoints:**
- `GET /subscriptions/plans` — list available plans (public)
- `POST /subscriptions/customer` — create Stripe customer
- `POST /subscriptions` — subscribe to a plan
- `DELETE /subscriptions` — cancel subscription
- `POST /subscriptions/credits/topup` — purchase extra credits
- `POST /webhooks/stripe` — Stripe webhook handler
- `GET /providers` — discover vets/behaviourists
- `GET /providers/{vetId}` — vet profile + next availability
- `GET /providers/{vetId}/availability` — vet availability by date range
- `GET /providers/{vetId}/assessment` — owner's assessment with this vet
- `POST /assessments` — submit behaviour assessment
- `GET /assessments/{assessmentId}` — get assessment status
- `POST /bookings` — book a consultation
- `GET /bookings` — list owner's bookings
- `GET /bookings/{bookingId}` — booking detail
- `DELETE /bookings/{bookingId}` — cancel booking
- `GET /bookings/{bookingId}/token` — Agora RTC token for video call

---

## Phase 5 — Vet API

Vet-side dashboard, assessment queue, availability, booking management, messaging.

| Resource | Link |
|----------|------|
| Full spec | [`docs/spec-phase5-vet-api.md`](docs/spec-phase5-vet-api.md) |

**Endpoints:**
- `GET/PUT /vet/me` — vet profile
- `POST /vet/me/photo` — presigned S3 upload URL
- `GET /vet/assessments` — pending assessment queue
- `GET /vet/assessments/{assessmentId}` — assessment detail
- `PUT /vet/assessments/{assessmentId}/respond` — approve or reject assessment
- `GET /vet/availability` — get availability by date range
- `PUT /vet/availability/{date}` — set slots for a specific date
- `PUT /vet/availability` — bulk set slots for multiple dates
- `GET /vet/bookings` — list upcoming/past bookings
- `GET /vet/bookings/{bookingId}` — booking detail with owner + dog context
- `GET /vet/bookings/{bookingId}/token` — Agora RTC token for video call
- `POST /vet/bookings/{bookingId}/summary` — submit post-call summary
- `GET /vet/threads` — list threads
- `GET /vet/threads/{threadId}` — thread detail + messages
- `POST /vet/threads/{threadId}/messages` — send a message
- `PUT /vet/threads/{threadId}/close` — close thread
- `PUT /vet/threads/{threadId}/read` — mark owner messages as read
- `GET /vet/dashboard` — counts of pending items
- `GET /vet/notifications` — in-app notifications
- `PUT /vet/notifications/{notifId}/read` — mark notification as read

---

## Database Design

Single-table DynamoDB design covering all phases.

→ [`docs/dynamodb-table-design.md`](docs/dynamodb-table-design.md)

---

## Development

```bash
npm install

# Unit tests (no AWS needed)
npm test

# Integration tests (requires deployed dev stack)
npm run test:integration
```

---

## Deploy

```bash
# Deploy all functions to dev
npx serverless deploy --stage dev

# Deploy a single function (faster iteration)
npx serverless deploy function -f createDog --stage dev

# View logs
npx serverless logs -f createDog --stage dev --tail
```

CI/CD: GitHub Actions deploys to `dev` on merge to `main` (OIDC auth, no static keys).

---

## API Reference (Swagger)

Machine-readable OpenAPI 3.0 spec for all endpoints:

→ [`docs/openapi.yaml`](docs/openapi.yaml)

Import into Postman, Insomnia, or view at [editor.swagger.io](https://editor.swagger.io).
