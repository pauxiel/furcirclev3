# FurCircle Phase 1 — Task List

## Pre-Build (resolve before starting)
- [ ] **DECIDE** Breed list source: static JSON file vs DynamoDB table?
- [ ] **DECIDE** Push notification provider: Expo Push vs Firebase FCM?
- [ ] **DO** Add Anthropic API key to SSM: `aws ssm put-parameter --name /furcircle/dev/anthropic/apiKey --value <key> --type SecureString`

---

## Task 1 — Scaffolding + Infrastructure
- [ ] Create folder structure (`src/functions/`, `src/lib/`, `stepfunctions/`)
- [ ] Write `package.json` with all dependencies
- [ ] Run `npm install`
- [ ] Write `serverless.yml` — provider config, DynamoDB table + 3 GSIs, Cognito User Pool + Client + Groups, S3 bucket (CORS), SNS topic
- [ ] Write `src/lib/dynamodb.js` — DocumentClient singleton
- [ ] Write `src/lib/response.js` — `success()` and `error()` helpers
- [ ] Write `src/lib/auth.js` — `getUserId(event)` from JWT claims
- [ ] Write `src/lib/s3.js` — S3 client + `getPresignedPutUrl()`
- [ ] Deploy: `sls deploy --stage dev`
- [ ] Verify DynamoDB table, S3 bucket, Cognito User Pool, SNS topic in AWS console

---

## Task 2 — Post-Confirmation Lambda
- [ ] Write `src/functions/auth/postConfirmation.js`
- [ ] Wire Cognito PostConfirmation trigger in `serverless.yml`
- [ ] Add IAM: `dynamodb:PutItem`, `cognito-idp:AdminAddUserToGroup`
- [ ] Deploy + test: sign up → confirm → verify DynamoDB OWNER + SUBSCRIPTION records
- [ ] Verify user added to `owners` Cognito group

---

## Task 3 — JWT Authorizer + Owner APIs
- [ ] Add `httpApi.authorizers.cognitoAuthorizer` to `serverless.yml`
- [ ] Write `src/functions/owners/getMe.js`
- [ ] Write `src/functions/owners/updateMe.js`
- [ ] Add routes + IAM to `serverless.yml`
- [ ] Deploy + test: authenticated GET/PUT /owners/me
- [ ] Verify 401 on missing/expired token

---

## Task 4 — Dog Profile CRUD ✅ (impl done, 23 tests)
- [x] Write `src/functions/dogs/createDog.ts`
- [x] Write `src/functions/dogs/listDogs.ts`
- [x] Write `src/functions/dogs/getDog.ts`
- [x] Write `src/functions/dogs/updateDog.ts`
- [ ] Add routes + IAM to `serverless.yml`
- [ ] Deploy + test all 4 endpoints
- [ ] Verify ownership enforcement (403 for wrong owner)
- [ ] Verify health records created for spayedNeutered + medicalConditions

---

## Task 5 — Dog Photo Upload ✅ (impl done, 6 tests)
- [x] `src/lib/s3.ts` presigned URL helper
- [x] Write `src/functions/dogs/getDogPhotoUrl.ts`
- [ ] Add S3 CORS config to `serverless.yml` (allow PUT)
- [ ] Add route + IAM (`s3:PutObject`) to `serverless.yml`
- [ ] Deploy + test: get URL → curl PUT to S3 → verify file exists
- [ ] Test: update dog profile with returned photoUrl

---

## Task 6 — Step Function + AI Plan Generation ✅ (impl done, 19 tests)
- [ ] Store Anthropic API key in SSM Parameter Store
- [x] Write `src/lib/claude.ts` — Anthropic SDK wrapper, `generatePlan(dogProfile)`
- [ ] Write `stepfunctions/generatePlan.asl.json`
- [x] Write `src/functions/plan/validateInput.ts`
- [x] Write `src/functions/plan/callClaude.ts` (build prompt, call Claude, parse JSON)
- [x] Write `src/functions/plan/savePlan.ts` (write PLAN record, update dog planStatus)
- [x] Write `src/functions/plan/notifyPlanReady.ts` (SNS publish)
- [x] Write `src/functions/plan/handlePlanError.ts` (set planStatus=failed)
- [ ] Add Step Functions state machine to `serverless.yml`
- [x] Update `createDog.ts` to call `sfn.startExecution()` after dog PutItem
- [ ] Add IAM for Step Functions to createDog and for DynamoDB/SNS to plan Lambdas
- [ ] Deploy + test: create dog → watch Step Function in console → verify plan in DynamoDB
- [ ] Verify `planStatus=ready` on dog record after execution

---

## Task 7 — Plan Read API ✅ (impl done, 5 tests)
- [x] Write `src/functions/dogs/getCurrentPlan.ts`
- [ ] Add route to `serverless.yml`
- [ ] Deploy + test: `GET /dogs/{dogId}/plan` returns full plan
- [ ] Test: returns `{ planStatus: 'generating' }` when plan not yet ready
- [ ] Test: `?month=` query param works for historical plans
- [ ] Verify all 4 pillars and exactly 3 milestones present

---

## Checkpoint — E2E Smoke Test
- [ ] Run full onboarding flow (10 steps in plan.md)
- [ ] Check CloudWatch for Lambda errors
- [ ] Check Step Functions execution history — all states green
- [ ] Confirm plan content is breed-specific (not generic)
- [ ] Sign off Phase 1 ✅ → begin Phase 2 planning

---

## Phase 1 Done Definition
All tasks above checked. E2E smoke test passes. Zero Lambda errors in CloudWatch during test run.

---

# FurCircle Phase 2 — Task List

## Pre-Build (resolve before P2-T1)
- [ ] **DECIDE** Training videos: `videoUrl=null` for Phase 2, real URLs in Phase 3?
- [ ] **DECIDE** Wellness score on monthly refresh: reset to AI baseline?
- [ ] **VERIFY** Phase 1 Task 6 complete: `savePlan` writes `GSI1PK=PLAN#${yyyy-mm}` on plan records
- [ ] **DECIDE** Journey progress circles: use `ageMonthsAtPlan` (no separate tracking)?

---

## Task P2-T1 — Activity Log + Wellness Score
- [ ] Write `src/lib/wellness.ts` — `assignCategory()`, `recalcScore()`, `computeWellnessScore()`
- [ ] Write `src/functions/wellness/logActivity.ts`
  - [ ] Ownership check (403)
  - [ ] Task verification against current plan (400 TASK_NOT_FOUND)
  - [ ] Write ACTIVITY record to DynamoDB
  - [ ] Update `dog.categoryScores` + `dog.wellnessScore` via UpdateItem
- [ ] Write `src/functions/wellness/getActivities.ts`
  - [ ] Ownership check
  - [ ] Query ACTIVITY# items for month
  - [ ] Compute completedCount / totalTasks
- [ ] Add `POST /dogs/{dogId}/activities` route + IAM to `serverless.yml`
- [ ] Add `GET /dogs/{dogId}/activities` route + IAM to `serverless.yml`
- [ ] Write unit tests for `src/lib/wellness.ts` (category matching, score boundaries)
- [ ] Deploy + verify: log a task → check score updated in DynamoDB
- [ ] Verify score never exceeds 100 or goes below 0

---

## Task P2-T2 — Monthly Journey Detail
- [ ] Write `src/functions/wellness/getMonthlyJourney.ts`
  - [ ] Ownership check
  - [ ] `?month` param support (default current month)
  - [ ] GetItem plan → enrich whatToDo with `completed` flag from activities
  - [ ] Derive `monthLabel`
- [ ] Add `GET /dogs/{dogId}/journey` route + IAM to `serverless.yml`
- [ ] Deploy + verify: completed tasks show `completed: true`

---

## Task P2-T3 — Home Screen API
- [ ] Write `src/functions/wellness/getHomeScreen.ts`
  - [ ] Parallel BatchGetItem: owner PROFILE + SUBSCRIPTION
  - [ ] Query dogs via GSI1
  - [ ] Parallel: GetItem plan + Query activities
  - [ ] Build actionSteps with completion status
  - [ ] Build pillSummaries
  - [ ] Build ctaBanners (upgrade banner for welcome/protector plans)
  - [ ] Handle: no dog, plan generating, no plan cases
- [ ] Add `GET /home` route + IAM to `serverless.yml`
- [ ] Deploy + verify: full home screen response in < 500ms

---

## Task P2-T4 — Monthly Auto-Refresh
- [ ] Verify `savePlan` writes GSI1PK=PLAN#${yyyy-mm} (prerequisite)
- [ ] Write `src/functions/plan/triggerMonthlyRefresh.ts`
  - [ ] Query GSI1 with pagination for all plans from prevMonth
  - [ ] Fan out Step Functions in batches of 25 with `Promise.allSettled`
  - [ ] Log counts to CloudWatch
- [ ] Add EventBridge `schedule: cron(0 0 1 * ? *)` to `serverless.yml`
- [ ] Add IAM: `dynamodb:Query` on GSI1 + `states:StartExecution`
- [ ] Deploy + manually invoke → verify Step Functions start per dog
- [ ] Verify CloudWatch logs show dog count + success/failure

---

## Checkpoint — Phase 2 E2E Smoke Test
- [ ] Run full 10-step flow (see plan-phase2 checkpoint)
- [ ] `GET /home` response time < 500ms (measure with curl)
- [ ] Wellness score changes correctly across logged activities
- [ ] EventBridge rule visible and enabled in AWS console
- [ ] `npm run test:integration` — all Phase 1 + Phase 2 tests pass
- [ ] Zero Lambda errors in CloudWatch
- [ ] Sign off Phase 2 ✅ → begin Phase 3 planning

---

## Phase 2 Done Definition
All tasks above checked. E2E smoke test passes. Home screen < 500ms. Zero Lambda errors.

---

# FurCircle Phase 3 — Task List

## Task P3-T1 — createThread
- [ ] Write `src/lib/threads.ts` — types, encodeCursor/decodeCursor, chunkArray
- [ ] Write `src/functions/threads/createThread.ts`
  - [ ] Validate vetId, dogId, type, initialMessage (1–2000 chars)
  - [ ] Parallel: GetItem dog + GetItem subscription + GetItem vet
  - [ ] Subscription gate: welcome plan → Query GSI1 by month prefix, 403 if count ≥ 1
  - [ ] Parallel: PutItem THREAD METADATA + PutItem first MSG
  - [ ] try/catch SNS publish to vet (non-fatal)
- [ ] Add `POST /threads` route + IAM to `serverless.yml`
- [ ] Write unit tests (9 cases)
- [ ] Deploy + smoke test

---

## Task P3-T2 — listThreads
- [ ] Write `src/functions/threads/listThreads.ts`
  - [ ] Query GSI1 by owner (ScanIndexForward=false)
  - [ ] Type filter via GSI1SK prefix; status filter post-query
  - [ ] Single BatchGetItem for all vet+dog profiles
  - [ ] Promise.all per-thread: last message query + unread count
  - [ ] base64 nextToken pagination
- [ ] Add `GET /threads` route + IAM to `serverless.yml`
- [ ] Write unit tests (10 cases)
- [ ] Deploy + smoke test

---

## Task P3-T3 — getThread
- [ ] Write `src/functions/threads/getThread.ts`
  - [ ] GetItem METADATA → ownership check
  - [ ] Promise.all: Query messages + GetItem vet + GetItem dog + GetItem owner
  - [ ] Derive senderName per message
  - [ ] base64 nextToken pagination
- [ ] Add `GET /threads/{threadId}` route + IAM to `serverless.yml`
- [ ] Write unit tests (9 cases)
- [ ] Deploy + smoke test

---

## Task P3-T4 — sendMessage
- [ ] Write `src/functions/threads/sendMessage.ts`
  - [ ] GetItem METADATA → ownership + open status check
  - [ ] Validate body (1–2000 chars)
  - [ ] PutItem MSG record
  - [ ] try/catch SNS publish to vet (non-fatal)
- [ ] Add `POST /threads/{threadId}/messages` route + IAM to `serverless.yml`
- [ ] Write unit tests (8 cases)
- [ ] Deploy + smoke test

---

## Task P3-T5 — markThreadRead
- [ ] Write `src/functions/threads/markThreadRead.ts`
  - [ ] GetItem METADATA → ownership check
  - [ ] Paginated query loop for all messages
  - [ ] Filter unread vet messages; early return if 0
  - [ ] Chunk into 25s, Promise.all UpdateItem readAt=now
- [ ] Add `PUT /threads/{threadId}/read` route + IAM to `serverless.yml`
- [ ] Write unit tests (8 cases)
- [ ] Deploy + smoke test

---

## Task P3-T6 — closeExpiredThreads
- [ ] Write `src/functions/threads/closeExpiredThreads.ts`
  - [ ] Paginated Scan: type=post_booking AND status=open AND closedAt <= now
  - [ ] ExpressionAttributeNames for reserved words (status, type)
  - [ ] Promise.allSettled: UpdateItem closed + SNS push owner
  - [ ] Log total closed count
- [ ] Add EventBridge schedule cron(0 1 * * ? *) + IAM to `serverless.yml`
- [ ] Write unit tests (8 cases)
- [ ] Deploy + manually invoke → verify

---

## Checkpoint — Phase 3 E2E Smoke Test
- [ ] createThread → 201, METADATA + MSG in DynamoDB
- [ ] listThreads → threads with vet, dog, lastMessage, unreadCount
- [ ] getThread → full messages, senderName, dogProfileVisible=true
- [ ] sendMessage → 201, MSG in DynamoDB, SNS triggered
- [ ] markThreadRead → markedRead count correct
- [ ] closeExpiredThreads manual invoke → status=closed in DynamoDB
- [ ] welcome plan gate: second thread in same month → 403 MONTHLY_LIMIT_REACHED
- [ ] Zero Lambda errors in CloudWatch
- [ ] Sign off Phase 3 ✅ → begin Phase 4 planning

---

## Phase 3 Done Definition
All tasks above checked. E2E smoke test passes. Zero Lambda errors. EventBridge rule visible in AWS console.

---

# FurCircle Phase 4 — Task List

## Pre-Build (resolve before P4-T1)
- [ ] **DO** Add Stripe secret key to SSM: `aws ssm put-parameter --name /furcircle/dev/stripe/secretKey --value <key> --type SecureString`
- [ ] **DO** Add Stripe webhook secret to SSM: `aws ssm put-parameter --name /furcircle/dev/stripe/webhookSecret --value <secret> --type SecureString`
- [ ] **DO** Add Agora App ID to SSM: `aws ssm put-parameter --name /furcircle/dev/agora/appId --value <id> --type String`
- [ ] **DO** Add Agora App Certificate to SSM: `aws ssm put-parameter --name /furcircle/dev/agora/appCertificate --value <cert> --type SecureString`
- [ ] **DECIDE** Stripe webhook owner lookup: find owner by stripeCustomerId via email lookup (GSI1 EMAIL#) or scan? (Recommend: use email from Stripe customer object → GSI1 lookup)
- [ ] **DECIDE** Credits rollover month-to-month or reset on billing renewal? (Recommend: reset — aligns with Stripe invoice cycle, simpler)
- [ ] **DECIDE** Assessment per owner+vet: one-time forever or resets after N months? (Recommend: one-time per owner+vet pair, vet-initiated re-assessment only)

---

## Task P4-T1 — Stripe + Agora Shared Libs
- [ ] Run `npm install stripe agora-token`
- [ ] Write `src/lib/stripe.ts` — Stripe SDK singleton, reads `/furcircle/${stage}/stripe/secretKey` from SSM at cold start
- [ ] Write `src/lib/agora.ts` — `generateRtcToken(channelName, uid, expirySeconds)` using `agora-token` package, reads appId + appCertificate from SSM at cold start
- [ ] Add SSM param names to `serverless.yml` environment block for Phase 4 Lambdas
- [ ] Deploy: `sls deploy --stage dev` — verify no missing module errors

---

## Task P4-T2 — Subscription Management APIs
- [ ] Write `src/functions/subscriptions/getSubscriptionPlans.ts`
  - [ ] No Cognito auth — public endpoint
  - [ ] Return hardcoded plan catalogue (welcome, protector, proactive) matching spec
- [ ] Write `src/functions/subscriptions/createStripeCustomer.ts`
  - [ ] Idempotent — if `stripeCustomerId` already set on subscription record, return it unchanged
  - [ ] Create Stripe customer using owner's email (GetItem OWNER PROFILE)
  - [ ] UpdateItem SUBSCRIPTION with `stripeCustomerId`
- [ ] Write `src/functions/subscriptions/subscribeToPlan.ts`
  - [ ] GetItem SUBSCRIPTION → verify stripeCustomerId exists
  - [ ] Attach `paymentMethodId` to Stripe customer
  - [ ] Create Stripe Subscription using plan's `stripePriceId`
  - [ ] UpdateItem SUBSCRIPTION: plan, stripeSubscriptionId, status=active, currentPeriodEnd
  - [ ] If upgrading to proactive: SET creditBalance=70 (first month)
- [ ] Write `src/functions/subscriptions/cancelSubscription.ts`
  - [ ] Stripe: `subscriptions.update(id, { cancel_at_period_end: true })`
  - [ ] UpdateItem SUBSCRIPTION: status=cancelling
- [ ] Write `src/functions/subscriptions/topUpCredits.ts`
  - [ ] Validate `credits` is one of 10, 20, 50
  - [ ] Create + confirm Stripe PaymentIntent for corresponding amount
  - [ ] ADD creditBalance :credits on SUBSCRIPTION record
- [ ] Add all 5 routes + IAM to `serverless.yml`
- [ ] Write unit tests (getSubscriptionPlans: 1, createStripeCustomer: 3, subscribeToPlan: 4, cancelSubscription: 2, topUpCredits: 4)
- [ ] Deploy + smoke test each endpoint

---

## Task P4-T3 — Stripe Webhook
- [ ] Write `src/functions/subscriptions/stripeWebhook.ts`
  - [ ] Verify `stripe-signature` header using webhookSecret from SSM → 400 on invalid signature
  - [ ] Handle `invoice.payment_succeeded`: if plan=proactive, SET creditBalance=70 (reset)
  - [ ] Handle `invoice.payment_failed`: SET status=past_due, try/catch SNS push to owner
  - [ ] Handle `customer.subscription.updated`: sync plan, status, currentPeriodEnd to SUBSCRIPTION
  - [ ] Handle `customer.subscription.deleted`: SET plan=welcome, creditBalance=0, status=active
  - [ ] Always return 200 `{}` — log errors internally, never surface to Stripe
  - [ ] Owner lookup: get customer email from Stripe event → GSI1 EMAIL#${email} → OWNER
- [ ] Add `POST /webhooks/stripe` route (no Cognito auth) to `serverless.yml`
- [ ] Add IAM: dynamodb:Query (GSI1 index), dynamodb:UpdateItem, ssm:GetParameter, sns:Publish
- [ ] Write unit tests (5 cases: each event type + invalid signature)
- [ ] Deploy + test with Stripe CLI: `stripe listen --forward-to https://<api>/dev/webhooks/stripe`

---

## Task P4-T4 — Provider + Availability APIs
- [ ] Write `src/functions/providers/listProviders.ts`
  - [ ] Validate `type` query param: `behaviourist` or `nutritionist` (400 if missing/invalid)
  - [ ] Query GSI3: `GSI3PK=PROVIDER_TYPE#${type}`, ScanIndexForward=false (rating DESC)
  - [ ] For each vet: Query GSI1 `OWNER#${ownerId}` + `ASSESSMENT#${vetId}` → derive assessmentStatus
  - [ ] GetItem SUBSCRIPTION → derive canBook: behaviourist = assessmentStatus=approved AND plan=proactive; nutritionist = plan=proactive
- [ ] Write `src/functions/providers/getProvider.ts`
  - [ ] GetItem `VET#${vetId}/PROFILE`
  - [ ] Query GSI1 for owner's assessment with this vet
  - [ ] Query vet availability: next available date
  - [ ] Return full provider shape including bio, nextAvailable
- [ ] Write `src/functions/providers/getProviderAvailability.ts`
  - [ ] Validate startDate + endDate (both required, max 14-day window → 400 if exceeded)
  - [ ] Query `PK=VET#${vetId}`, `SK between AVAIL#${startDate} and AVAIL#${endDate}`
  - [ ] Return per-date slot arrays (empty array for dates with no slots)
- [ ] Write `src/functions/providers/getProviderAssessment.ts`
  - [ ] `GET /providers/{vetId}/assessment`
  - [ ] Query GSI1: `GSI1PK=OWNER#${ownerId}`, `GSI1SK=ASSESSMENT#${vetId}`
  - [ ] Return assessment record or 404 if none exists
- [ ] Add all 4 routes + IAM to `serverless.yml`
- [ ] Write unit tests (listProviders: 5, getProvider: 3, getProviderAvailability: 4, getProviderAssessment: 3)
- [ ] Deploy + smoke test (requires seed vet records in DynamoDB)

---

## Task P4-T5 — Assessment APIs
- [ ] Write `src/functions/assessments/submitAssessment.ts`
  - [ ] Validate: description min 50 chars (400), mediaUrls max 3 items (400), each must be S3 URL under `assessments/` path
  - [ ] Query GSI1 `OWNER#${ownerId}` + `ASSESSMENT#${vetId}` → 409 ASSESSMENT_EXISTS if pending or approved
  - [ ] PutItem ASSESSMENT record: status=pending, GSI1 + GSI2 keys set
  - [ ] try/catch SNS push notification to vet (non-fatal)
- [ ] Write `src/functions/assessments/getAssessment.ts`
  - [ ] GetItem `ASSESSMENT#${assessmentId}/ASSESSMENT`
  - [ ] Ownership check: ownerId === userId → 403 if mismatch
  - [ ] Return full assessment including vetResponse + reviewedAt
- [ ] Add `POST /assessments` + `GET /assessments/{assessmentId}` routes + IAM to `serverless.yml`
- [ ] Write unit tests (submitAssessment: 6, getAssessment: 4)
- [ ] Deploy + smoke test

---

## Task P4-T6 — Booking CRUD
- [ ] Write `src/functions/bookings/createBooking.ts`
  - [ ] Validate: duration 15 or 30, scheduledAt is future datetime
  - [ ] GetItem SUBSCRIPTION → 403 if plan ≠ proactive; 402 INSUFFICIENT_CREDITS if creditBalance < duration
  - [ ] If behaviourist: GetItem assessment → 400 if assessmentId missing or status ≠ approved
  - [ ] GetItem vet availability slot → 409 SLOT_UNAVAILABLE if slot taken
  - [ ] Atomic credit deduction: UpdateItem SUBSCRIPTION with ConditionExpression `creditBalance >= :cost` → 402 on failure
  - [ ] UpdateItem vet availability: mark slot unavailable
  - [ ] PutItem BOOKING: status=upcoming, agoraChannelId=`furcircle-booking-${bookingId}`, GSI1 + GSI2 keys with status embedded in SK
  - [ ] try/catch SNS push to vet + owner (non-fatal)
- [ ] Write `src/functions/bookings/listBookings.ts`
  - [ ] Optional `status` param: `upcoming` → `BOOKING#upcoming`, `past` → `BOOKING#completed` (default: all)
  - [ ] Query GSI1: `GSI1PK=OWNER#${ownerId}`, `GSI1SK begins_with BOOKING#${statusPrefix}`
  - [ ] BatchGetItem for vet + dog profiles (flatten into response)
- [ ] Write `src/functions/bookings/getBooking.ts`
  - [ ] GetItem `BOOKING#${bookingId}/BOOKING`
  - [ ] Ownership check: ownerId === userId → 403
  - [ ] Return full booking including agoraChannelId and postCallSummary (if set)
- [ ] Write `src/functions/bookings/cancelBooking.ts`
  - [ ] GetItem booking → verify ownerId === userId (403), status=upcoming (400)
  - [ ] Compute cancellation window: scheduledAt − now > 24h → full refund; else no refund
  - [ ] UpdateItem booking: status=cancelled
  - [ ] If refund eligible: ADD creditBalance :cost on SUBSCRIPTION record
  - [ ] UpdateItem vet availability: restore slot to available
  - [ ] try/catch SNS push to vet (non-fatal)
- [ ] Add all 4 routes + IAM to `serverless.yml`
- [ ] Write unit tests (createBooking: 8, listBookings: 4, getBooking: 3, cancelBooking: 6)
- [ ] Deploy + smoke test

---

## Task P4-T7 — Agora Token
- [ ] Write `src/functions/bookings/getAgoraToken.ts`
  - [ ] GetItem `BOOKING#${bookingId}/BOOKING`
  - [ ] Auth check: userId must be booking's ownerId OR vetId → 403 otherwise
  - [ ] Verify booking status=upcoming → 400 if not
  - [ ] Verify scheduledAt within ±30 minutes of now → 403 TOO_EARLY if more than 30min before
  - [ ] Generate UID: deterministic uint32 hash of userId (e.g. djb2 or xxhash)
  - [ ] Call `src/lib/agora.ts` generateRtcToken(agoraChannelId, uid, 3600)
  - [ ] Return token, channelId, uid, appId, expiresAt
- [ ] Add `GET /bookings/{bookingId}/token` route + IAM to `serverless.yml`
- [ ] Write unit tests (6 cases: owner access, vet access, 403 wrong user, 403 too early, 400 not upcoming, valid token shape)
- [ ] Deploy + smoke test

---

## Checkpoint — Phase 4 E2E Smoke Test
- [ ] GET /subscriptions/plans (no auth) → 3 plans, correct shape
- [ ] POST /subscriptions/customer → stripeCustomerId stored in SUBSCRIPTION record
- [ ] POST /subscriptions (proactive) → plan=proactive, creditBalance=70, status=active
- [ ] GET /providers?type=behaviourist → list with assessmentStatus=none, canBook=false
- [ ] POST /assessments → 201 ASSESSMENT record status=pending
- [ ] GET /assessments/{id} → pending status + description
- [ ] POST /bookings (behaviourist, non-approved assessment) → 400
- [ ] POST /bookings (valid proactive, approved assessment) → 201 with agoraChannelId, creditBalance deducted
- [ ] DELETE /bookings/{id} (> 24h before) → status=cancelled, credits refunded
- [ ] GET /bookings/{id}/token (within ±30min window) → valid Agora RTC token
- [ ] POST /webhooks/stripe invoice.payment_succeeded → creditBalance reset to 70 in DynamoDB
- [ ] POST /webhooks/stripe customer.subscription.deleted → plan=welcome, creditBalance=0
- [ ] Zero Lambda errors in CloudWatch
- [ ] Sign off Phase 4 ✅ → begin Phase 5 planning

---

## Phase 4 Done Definition
All tasks above checked. E2E smoke test passes. Stripe webhook verified via Stripe CLI. Agora token generates valid RTC token for booking owner and vet. Zero Lambda errors.
