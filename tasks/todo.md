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

## Task 4 — Dog Profile CRUD
- [ ] Write `src/functions/dogs/createDog.js` (without Step Function trigger)
- [ ] Write `src/functions/dogs/listDogs.js`
- [ ] Write `src/functions/dogs/getDog.js`
- [ ] Write `src/functions/dogs/updateDog.js`
- [ ] Add routes + IAM to `serverless.yml`
- [ ] Deploy + test all 4 endpoints
- [ ] Verify ownership enforcement (403 for wrong owner)
- [ ] Verify health records created for spayedNeutered + medicalConditions

---

## Task 5 — Dog Photo Upload
- [ ] Update `src/lib/s3.js` with presigned URL helper
- [ ] Write `src/functions/dogs/getDogPhotoUrl.js`
- [ ] Add S3 CORS config to `serverless.yml` (allow PUT)
- [ ] Add route + IAM (`s3:PutObject`) to `serverless.yml`
- [ ] Deploy + test: get URL → curl PUT to S3 → verify file exists
- [ ] Test: update dog profile with returned photoUrl

---

## Task 6 — Step Function + AI Plan Generation
- [ ] Store Anthropic API key in SSM Parameter Store
- [ ] Write `src/lib/claude.js` — Anthropic SDK wrapper, `generatePlan(dogProfile)`
- [ ] Write `stepfunctions/generatePlan.asl.json`
- [ ] Write `src/functions/plan/validateInput.js`
- [ ] Write `src/functions/plan/callClaude.js` (build prompt, call Claude, parse JSON)
- [ ] Write `src/functions/plan/savePlan.js` (write PLAN record, update dog planStatus)
- [ ] Write `src/functions/plan/notifyPlanReady.js` (SNS publish)
- [ ] Write `src/functions/plan/handlePlanError.js` (set planStatus=failed)
- [ ] Add Step Functions state machine to `serverless.yml`
- [ ] Update `createDog.js` to call `sfn.startExecution()` after dog PutItem
- [ ] Add IAM for Step Functions to createDog and for DynamoDB/SNS to plan Lambdas
- [ ] Deploy + test: create dog → watch Step Function in console → verify plan in DynamoDB
- [ ] Verify `planStatus=ready` on dog record after execution

---

## Task 7 — Plan Read API
- [ ] Write `src/functions/dogs/getCurrentPlan.js`
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
