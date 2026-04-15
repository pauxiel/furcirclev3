# FurCircle — Phase 1 Implementation Plan
# Auth + Onboarding

## Reference Spec
`docs/spec-phase1-auth-onboarding.md` + `docs/dynamodb-table-design.md`

---

## Dependency Graph

```
[1] Scaffolding + serverless.yml infrastructure
        │
        ├──────────────────────────────┐
        ▼                              ▼
[2] Shared libraries              [3] Cognito JWT Authorizer config
        │                              │
        ├──────────────┐               │
        ▼              ▼               ▼
[4] postConfirmation  [5] Owner APIs (GET/PUT /owners/me)
    Lambda                 │
        │                  │
        └─────┬────────────┘
              ▼
[6] Dog CRUD (POST, GET, PUT /dogs)
              │
              ├──────────────────────┐
              ▼                      ▼
[7] Dog photo upload          [8] Step Function + Claude plan gen
    (POST /dogs/{id}/photo)          │
                                     ▼
                              [9] Plan read API
                                  (GET /dogs/{id}/plan)
                                     │
                                     ▼
                              [CHECKPOINT] E2E smoke test
```

---

## Task 1 — Project Scaffolding + Infrastructure

**What:** Set up the project structure, install dependencies, and define all AWS resources in `serverless.yml`.

**Vertical slice:** Everything that must exist before a single Lambda can run.

**Files created:**
- `package.json` — dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sfn`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-sns`, `@anthropic-ai/sdk`, `uuid`
- `serverless.yml` — full resource definitions (see below)
- `src/lib/dynamodb.js` — DynamoDB DocumentClient singleton
- `src/lib/s3.js` — S3 client + `getPresignedPutUrl(key, contentType)` helper
- `src/lib/response.js` — `success(data, statusCode)`, `error(code, message, statusCode)`
- `src/lib/auth.js` — `getUserId(event)` extracts Cognito sub from JWT claims

**serverless.yml resources:**
- Provider: `aws`, `nodejs20.x`, `us-east-1`, `256mb` default memory, `30s` timeout
- Cognito User Pool: `furcircle-users-${stage}` with email sign-in, OTP verification, password policy
- Cognito User Pool Client: `furcircle-app` (no secret, SRP + refresh token auth)
- Cognito Groups: `owners`, `vets`
- DynamoDB Table: `furcircle-${stage}` with PK/SK + GSI1/GSI2/GSI3 (PAY_PER_REQUEST)
- S3 Bucket: `furcircle-dog-photos-${stage}` (private, CORS PUT allowed)
- SNS Topic: `furcircle-notifications-${stage}`
- Outputs: UserPoolId, UserPoolClientId, TableName, BucketName, SnsTopicArn (exported for Lambda env vars)

**Acceptance criteria:**
- [ ] `npm install` completes with no errors
- [ ] `serverless deploy --stage dev` succeeds
- [ ] DynamoDB table exists with correct PK/SK and all 3 GSIs visible in AWS console
- [ ] S3 bucket exists with block public access enabled
- [ ] Cognito User Pool exists with `owners` and `vets` groups
- [ ] SNS topic exists

**Verification:**
```bash
sls deploy --stage dev
aws dynamodb describe-table --table-name furcircle-dev --query 'Table.GlobalSecondaryIndexes[*].IndexName'
aws s3api get-bucket-acl --bucket furcircle-dog-photos-dev
aws cognito-idp list-groups --user-pool-id <UserPoolId>
```

---

## Task 2 — Cognito Post-Confirmation Lambda

**What:** Lambda that fires after a user confirms their email. Creates the OWNER profile + SUBSCRIPTION record in DynamoDB, adds user to `owners` group.

**Vertical slice:** Sign-up flow works end to end. Without this, no owner record exists.

**Files created:**
- `src/functions/auth/postConfirmation.js`

**Logic:**
1. Read `sub`, `email`, `given_name`, `family_name` from Cognito event
2. Generate 6-char alphanumeric referral code
3. `PutItem` OWNER profile record
4. `PutItem` SUBSCRIPTION record (`plan=welcome, creditBalance=0, status=active`)
5. `AdminAddUserToGroup` → `owners` group
6. Return Cognito event unchanged

**serverless.yml addition:**
- Function `postConfirmation` wired as Cognito User Pool `PostConfirmation` trigger
- IAM: `dynamodb:PutItem` on `furcircle-${stage}`, `cognito-idp:AdminAddUserToGroup`

**Acceptance criteria:**
- [ ] Sign up with a test email → confirm OTP → DynamoDB has `OWNER#${sub} / PROFILE` record
- [ ] DynamoDB has `OWNER#${sub} / SUBSCRIPTION` with `plan=welcome`
- [ ] Cognito user is in `owners` group
- [ ] Lambda does not throw on duplicate confirmation (idempotent PutItem)

**Verification:**
```bash
# Sign up via AWS CLI or Amplify test client
aws cognito-idp sign-up --client-id <ClientId> --username test@example.com --password Test1234! \
  --user-attributes Name=given_name,Value=Joshua Name=family_name,Value=Smith Name=email,Value=test@example.com
aws cognito-idp confirm-sign-up --client-id <ClientId> --username test@example.com --confirmation-code <code>
aws dynamodb get-item --table-name furcircle-dev \
  --key '{"PK":{"S":"OWNER#<sub>"},"SK":{"S":"PROFILE"}}'
```

---

## Task 3 — Cognito JWT Authorizer + Owner Profile APIs

**What:** Configure the API Gateway JWT authorizer, then build `GET /owners/me` and `PUT /owners/me`.

**Vertical slice:** Authenticated read/write of owner profile. First HTTP endpoints a mobile client hits after login.

**Files created:**
- `src/functions/owners/getMe.js`
- `src/functions/owners/updateMe.js`

**Authorizer config in serverless.yml:**
```yaml
httpApi:
  authorizers:
    cognitoAuthorizer:
      type: jwt
      identitySource: $request.header.Authorization
      issuerUrl: https://cognito-idp.us-east-1.amazonaws.com/<UserPoolId>
      audience:
        - <UserPoolClientId>
```

All owner + dog endpoints use `authorizer: cognitoAuthorizer`.

**getMe logic:**
1. Extract `userId` from JWT claims via `auth.getUserId(event)`
2. `BatchGetItem`: `OWNER#${userId}/PROFILE` + `OWNER#${userId}/SUBSCRIPTION`
3. Merge and return combined response shape

**updateMe logic:**
1. Extract userId
2. Validate allowed fields: `firstName`, `lastName`, `pushToken` (reject unknown fields)
3. Build `UpdateExpression` dynamically from provided fields + `updatedAt=now`
4. `UpdateItem` with condition `attribute_exists(PK)` (reject if owner doesn't exist)

**Acceptance criteria:**
- [ ] `GET /owners/me` with valid token → 200 with owner + subscription data
- [ ] `GET /owners/me` with no token → 401
- [ ] `GET /owners/me` with expired token → 401
- [ ] `PUT /owners/me` with `{ pushToken }` → 200, DynamoDB record updated
- [ ] `PUT /owners/me` with unknown field → field is ignored (not written)
- [ ] `PUT /owners/me` for non-existent owner → 404

**Verification:**
```bash
# Get token via SRP auth
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_SRP_AUTH ...)
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/owners/me
```

---

## Task 4 — Dog Profile CRUD

**What:** `POST /dogs`, `GET /dogs`, `GET /dogs/{dogId}`, `PUT /dogs/{dogId}`.

**Vertical slice:** Owner can register their dog. `POST /dogs` sets `planStatus=generating` but does NOT trigger the Step Function yet (that's Task 6). The plan step is wired in later.

**Files created:**
- `src/functions/dogs/createDog.js`
- `src/functions/dogs/listDogs.js`
- `src/functions/dogs/getDog.js`
- `src/functions/dogs/updateDog.js`

**createDog logic:**
1. Validate request body (name, breed, ageMonths, spayedNeutered — see spec)
2. Generate `dogId` (UUID), derive `dateOfBirth`
3. `PutItem` DOG profile with `planStatus=generating`
4. If `spayedNeutered !== 'not_yet'` → write `HEALTH#spayed_neutered#${id}` record
5. If `medicalConditions` non-empty → write `HEALTH#medical_condition#${id}` record
6. Return 201 (Step Function trigger added in Task 6)

**listDogs logic:**
1. `Query` GSI1: `GSI1PK=OWNER#${userId}`, `GSI1SK begins_with DOG#`
2. Return summary array

**getDog logic:**
1. `GetItem` DOG profile
2. Verify `ownerId === userId` (403 if mismatch)
3. `Query` health records: `PK=DOG#${dogId}`, `SK begins_with HEALTH#`
4. Return combined response

**updateDog logic:**
1. `GetItem` → verify ownership
2. Build dynamic `UpdateExpression` for provided fields
3. `UpdateItem` with `updatedAt=now`

**Acceptance criteria:**
- [ ] `POST /dogs` with valid body → 201, dog record in DynamoDB with `planStatus=generating`
- [ ] `POST /dogs` missing `name` → 400 `VALIDATION_ERROR`
- [ ] `POST /dogs` with `spayedNeutered=yes` → health record created
- [ ] `GET /dogs` → returns only dogs belonging to the authenticated owner
- [ ] `GET /dogs/{dogId}` → 200 with health records included
- [ ] `GET /dogs/{dogId}` for another owner's dog → 403
- [ ] `GET /dogs/{dogId}` non-existent → 404
- [ ] `PUT /dogs/{dogId}` → updates fields, returns updated dog

**Verification:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"name":"Buddy","breed":"Golden Retriever","ageMonths":3,"spayedNeutered":"not_yet"}' \
  https://<api>/dev/dogs
DOG_ID=<returned dogId>
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/dogs/$DOG_ID
```

---

## Task 5 — Dog Photo Upload (Presigned S3 URL)

**What:** `POST /dogs/{dogId}/photo` returns a presigned PUT URL. Owner uploads directly to S3, then updates dog profile via `PUT /dogs/{dogId}`.

**Vertical slice:** Photo upload path works end to end.

**Files created:**
- `src/functions/dogs/getDogPhotoUrl.js`
- Updates `src/lib/s3.js` with `getPresignedPutUrl(bucket, key, contentType, expiresIn)`

**Logic:**
1. `GetItem` dog → verify ownership
2. Validate `contentType`: must be `image/jpeg` or `image/png`
3. Determine extension from contentType (`jpeg` or `png`)
4. Key: `dogs/${dogId}/profile.${ext}`
5. Call `s3.getPresignedPutUrl(bucket, key, contentType, 300)`
6. Return `{ uploadUrl, photoUrl, expiresIn: 300 }`

**IAM:** `s3:PutObject` on `furcircle-dog-photos-${stage}/*`

**Acceptance criteria:**
- [ ] `POST /dogs/{dogId}/photo` with `image/jpeg` → 200 with signed URL
- [ ] Signed URL can be used to `PUT` a JPEG directly to S3 (test with curl)
- [ ] After PUT to S3, calling `PUT /dogs/{dogId}` with `{ photoUrl }` updates the record
- [ ] `POST /dogs/{dogId}/photo` with unsupported contentType → 400
- [ ] `POST /dogs/{dogId}/photo` for another owner's dog → 403

**Verification:**
```bash
RESULT=$(curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"contentType":"image/jpeg"}' \
  https://<api>/dev/dogs/$DOG_ID/photo)
UPLOAD_URL=$(echo $RESULT | jq -r '.uploadUrl')
PHOTO_URL=$(echo $RESULT | jq -r '.photoUrl')
curl -X PUT -H "Content-Type: image/jpeg" --data-binary @test.jpg "$UPLOAD_URL"
# Verify file in S3
aws s3 ls s3://furcircle-dog-photos-dev/dogs/$DOG_ID/
```

---

## Task 6 — Step Function + AI Plan Generation

**What:** Build the full AI plan generation pipeline. Four Lambda steps wired into a Step Functions state machine. Update `createDog` to trigger the execution.

**Vertical slice:** Dog is created → Step Function runs → Claude generates plan → plan saved to DynamoDB → push notification sent → `planStatus=ready`.

**Files created:**
- `src/lib/claude.js` — Anthropic SDK wrapper with `generatePlan(dogProfile)` function
- `src/functions/plan/validateInput.js`
- `src/functions/plan/callClaude.js`
- `src/functions/plan/savePlan.js`
- `src/functions/plan/notifyPlanReady.js`
- `stepfunctions/generatePlan.asl.json`

**ASL state machine:**
```json
{
  "Comment": "FurCircle AI plan generation",
  "StartAt": "ValidateInput",
  "States": {
    "ValidateInput": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:validateInput",
      "Next": "CallClaude",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "HandleError" }]
    },
    "CallClaude": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:callClaude",
      "Retry": [{ "ErrorEquals": ["States.ALL"], "MaxAttempts": 2, "IntervalSeconds": 5 }],
      "Next": "SavePlan",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "HandleError" }]
    },
    "SavePlan": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:savePlan",
      "Next": "NotifyUser",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "HandleError" }]
    },
    "NotifyUser": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:notifyPlanReady",
      "End": true
    },
    "HandleError": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:handlePlanError",
      "End": true
    }
  }
}
```

**validateInput:** `GetItem` dog, verify exists, pass `{ dogId, breed, ageMonths, spayedNeutered, medicalConditions, environment }` forward.

**callClaude:** Build prompt from spec, call `anthropic.messages.create()`, parse JSON response, pass plan data forward.

**savePlan:**
- `PutItem` PLAN record: `DOG#${dogId} / PLAN#${yyyy-mm}`
- `UpdateItem` dog: `SET wellnessScore=:score, planStatus=:ready, updatedAt=:now`

**notifyPlanReady:** Get owner's `pushToken` from DynamoDB, `SNS.publish()` notification payload. No pushToken → log and continue (don't fail).

**handlePlanError:** `UpdateItem` dog: `SET planStatus=:failed`. Log error. Publish SNS failure notification to owner.

**Anthropic API key:** Read from SSM: `/furcircle/${stage}/anthropic/apiKey` at cold start.

**Update createDog:** After PutItem dog, call `sfn.startExecution({ stateMachineArn, input: JSON.stringify({ dogId }) })`.

**Acceptance criteria:**
- [ ] `POST /dogs` → Step Function execution visible in AWS console within 5 seconds
- [ ] Step Function completes successfully (all states green)
- [ ] DynamoDB has `DOG#${dogId} / PLAN#${yyyy-mm}` record with all 4 pillars
- [ ] Dog record has `planStatus=ready` and `wellnessScore` set
- [ ] Claude response is valid JSON matching the spec schema (no markdown wrapping)
- [ ] `callClaude` retries up to 2 times on Claude API error
- [ ] On failure: dog record has `planStatus=failed`

**Verification:**
```bash
# Create dog — triggers Step Function
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"name":"Buddy","breed":"Golden Retriever","ageMonths":3,"spayedNeutered":"not_yet","environment":"Apartment"}' \
  https://<api>/dev/dogs

# Poll until planStatus=ready (or check Step Functions console)
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/dogs/$DOG_ID

# Verify plan in DynamoDB
MONTH=$(date +%Y-%m)
aws dynamodb get-item --table-name furcircle-dev \
  --key "{\"PK\":{\"S\":\"DOG#$DOG_ID\"},\"SK\":{\"S\":\"PLAN#$MONTH\"}}"
```

---

## Task 7 — Plan Read API

**What:** `GET /dogs/{dogId}/plan` — returns the current month's plan. Handles `planStatus=generating`, `planStatus=ready`, and no-plan-yet states.

**Files created:**
- `src/functions/dogs/getCurrentPlan.js`

**Logic:**
1. `GetItem` dog → verify ownership
2. If `planStatus=generating` → return 200 `{ dogId, month, planStatus: 'generating' }`
3. Get current month: `yyyy-mm`
4. `GetItem` plan: `PK=DOG#${dogId}, SK=PLAN#${currentMonth}`
5. If no plan → 404
6. Return full plan JSON

**Optional:** Support `?month=2026-03` query param (returns historical plan).

**Acceptance criteria:**
- [ ] After Task 6 completes, `GET /dogs/{dogId}/plan` → 200 full plan
- [ ] Immediately after `POST /dogs` (before Step Function completes) → 200 `{ planStatus: 'generating' }`
- [ ] `GET /dogs/{dogId}/plan` for another owner's dog → 403
- [ ] `GET /dogs/{dogId}/plan?month=2026-03` for a past month with no plan → 404
- [ ] All 4 pillars present: `whatToDo`, `whatNotToDo`, `watchFor`, `earlyWarningSigns`
- [ ] `milestones` array has exactly 3 items

**Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/dogs/$DOG_ID/plan | jq '.'
# Verify milestone count
curl ... | jq '.milestones | length'  # must be 3
```

---

## Checkpoint — End-to-End Smoke Test

**When:** After Task 7. Before starting Phase 2.

**Test the complete onboarding flow:**

```
1. Sign up new owner (email + name + password)
2. Confirm email OTP
3. GET /owners/me → verify profile + welcome subscription
4. PUT /owners/me → update pushToken
5. POST /dogs → create Buddy (Golden Retriever, 3 months)
6. Poll GET /dogs/{dogId} until planStatus=ready (max 60s)
7. GET /dogs/{dogId}/plan → verify full 4-pillar plan
8. POST /dogs/{dogId}/photo → get presigned URL
9. PUT signed URL with test JPEG → verify 200
10. PUT /dogs/{dogId} with photoUrl → verify updated
```

**Pass criteria:**
- [ ] All 10 steps succeed without errors
- [ ] Plan has breed-specific content (not generic)
- [ ] No Lambda errors in CloudWatch
- [ ] Step Function execution shows all states green
- [ ] Cold start on createDog < 5s
- [ ] Claude plan generation completes within 30s

---

## Pre-Build Decisions (resolve before Task 1)

These are the open questions from the spec that affect implementation:

| # | Question | Recommendation | Decision needed |
|---|----------|---------------|----------------|
| 1 | Breed list — static JSON or DynamoDB? | Static JSON in Lambda package (faster, no DB read at sign-up) | Choose |
| 2 | Push notifications — Expo or FCM? | Expo Push (simpler for React Native; handles both iOS + Android) | Choose |
| 3 | `GET /plan` support `?month` query param? | Yes — same Lambda, add query param | Confirmed in spec |
| 4 | Monthly refresh — EventBridge or first-open? | EventBridge cron (Phase 2 concern, not Phase 1) | Phase 2 |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Claude returns non-JSON (markdown wrapped) | Medium | High | Strip code fences in `callClaude`; validate JSON.parse before saving |
| Step Function cold start delay > 30s for Claude | Low | Medium | 30s Lambda timeout is enough; Claude opus-4-6 responds in ~5–15s |
| Cognito trigger fails silently | Low | High | CloudWatch alarm on Lambda error count for `postConfirmation` |
| DynamoDB GSI not ready at deploy time | Low | Low | GSIs are created with the table; wait for `ACTIVE` status |
| Referral code collision | Very Low | Low | Retry generation if code already exists (PutItem condition check) |
