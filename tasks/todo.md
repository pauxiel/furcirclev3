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
