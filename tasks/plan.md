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


---
---

# FurCircle — Phase 2 Implementation Plan
# Home Screen & Wellness

## Reference Spec
`docs/spec-phase2-home-wellness.md`

**Prerequisite:** Phase 1 complete and deployed. All Phase 1 stubs replaced with real implementations.
**Critical Phase 1 check:** `savePlan` must write `GSI1PK=PLAN#${yyyy-mm}`, `GSI1SK=DOG#${dogId}` on the plan record — this is already in the table design but must be verified before Phase 2 Task 4.

---

## Dependency Graph

```
Phase 1 complete (dog + plan exist in DynamoDB)
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
[P2-T1] Activity Log +           [P2-T4] Monthly Auto-Refresh
        Wellness Score                 (independent of T1–T3)
    │
    ├──────────────────┐
    ▼                  ▼
[P2-T2] Monthly   [P2-T3] Home Screen
        Journey         (most complex — aggregates all)
    │
    ▼
[CHECKPOINT] Integration tests + E2E smoke test
```

---

## Pre-Build Decisions (resolve before P2-T1)

| # | Question | Recommendation | Decision |
|---|----------|---------------|----------|
| 1 | Training videos — plan field or separate VIDEO entity? | Keep as `videoUrl` field on `whatToDo` items (Claude already generates `videoTopic`). Set to `null` in Phase 2, wire real URLs in Phase 3. | Confirm |
| 2 | Journey progress circles — `ageMonths` mod 12 or separate tracking? | Use `ageMonths` at plan generation time. No separate tracking. | Confirm |
| 3 | Wellness score on monthly refresh — reset to AI baseline or carry over? | Reset to AI baseline each month (consistent, stateless). | Confirm |
| 4 | Category keyword matching — Lambda or utility lib? | Shared `src/lib/wellness.ts` — used by `logActivity` only. Keeps Lambdas thin. | Done in plan |

---

## Task P2-T1 — Activity Log + Wellness Score

**What:** `POST /dogs/{dogId}/activities` and `GET /dogs/{dogId}/activities`. Core data model for Phase 2 — both P2-T2 and P2-T3 read from this.

**Vertical slice:** Owner marks a task complete → score updates immediately → next `GET /home` or `GET /journey` reflects it.

**New files:**
- `src/functions/wellness/logActivity.ts`
- `src/functions/wellness/getActivities.ts`
- `src/lib/wellness.ts` — `assignCategory(taskText)` + `recalcScore(current, type)` + `computeWellnessScore(categoryScores)`

**DynamoDB entity written:**
```
PK=DOG#${dogId}
SK=ACTIVITY#${yyyy-mm}#${activityId}
GSI1PK=OWNER#${ownerId}
GSI1SK=ACTIVITY#${yyyy-mm}#${activityId}
```

**logActivity logic:**
1. `GetItem` dog → verify ownership (403 if mismatch, 404 if not found)
2. `GetItem` current plan → verify `taskText` exists in `plan.whatToDo[*].text` (400 `TASK_NOT_FOUND` if not)
3. Generate `activityId` (UUID), write `ACTIVITY` record
4. Compute new `categoryScore`:
   - `assignCategory(taskText)` → one of 4 categories
   - `+2` for `completed_task`, `-1` for `skipped_task`, clamped `[0, 100]`
   - `wellnessScore = Math.round(avg of 4 categories)`
5. `UpdateItem` dog: `SET categoryScores.${category}=:score, wellnessScore=:score, updatedAt=:now`
6. Return 201 with `activityId`, updated scores

**getActivities logic:**
1. Verify ownership (GetItem dog)
2. `?month` param or current month
3. `Query PK=DOG#${dogId}, SK begins_with ACTIVITY#${month}`
4. Count completed vs total tasks in plan for `completedCount` / `totalTasks`
5. Return activity list + counts

**Category keyword matching (`src/lib/wellness.ts`):**
```
train|command|sit|come|stay|down|leash|recall → trainingBehaviour
feed|food|diet|nutrition|meal|water|treat     → feedingNutrition
vaccin|vet|health|medical|groom|dental|weight → health
social|meet|people|dog|park|expo|experience   → socialisation
(no match)                                     → trainingBehaviour (default)
```

**serverless.yml additions:**
```yaml
logActivity:
  handler: src/functions/wellness/logActivity.handler
  events:
    - httpApi: { path: /dogs/{dogId}/activities, method: POST, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem], Resource: !GetAtt FurcircleTable.Arn }

getActivities:
  handler: src/functions/wellness/getActivities.handler
  events:
    - httpApi: { path: /dogs/{dogId}/activities, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem, dynamodb:Query], Resource: [!GetAtt FurcircleTable.Arn, !Sub "${FurcircleTable.Arn}/index/*"] }
```

**Acceptance criteria:**
- [ ] `POST /dogs/{dogId}/activities` with `completed_task` → 201, ACTIVITY record in DynamoDB
- [ ] `categoryScores.trainingBehaviour` increases by 2 for a training task
- [ ] `wellnessScore` is correct average of 4 categories after update
- [ ] `POST` with taskText not in current plan → 400 `TASK_NOT_FOUND`
- [ ] `POST` for another owner's dog → 403
- [ ] `GET /dogs/{dogId}/activities` → returns activity list + completedCount/totalTasks
- [ ] `GET` with `?month=2026-03` → returns activities for that month
- [ ] Score never exceeds 100 or goes below 0 (boundary test)

**Verification:**
```bash
# Log a training task
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"completed_task","taskText":"Teach sit, come, down and stay using positive reinforcement"}' \
  https://<api>/dev/dogs/$DOG_ID/activities

# Check updated wellness score on dog
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/dogs/$DOG_ID | jq '.categoryScores'
```

---

## Task P2-T2 — Monthly Journey Detail

**What:** `GET /dogs/{dogId}/journey` — full 4-pillar plan page with activity completion status per task.

**Vertical slice:** Owner can see the full monthly plan with each `whatToDo` item marked as completed or not.

**New files:**
- `src/functions/wellness/getMonthlyJourney.ts`

**Logic:**
1. `GetItem` dog → verify ownership
2. `?month` param or current month (`yyyy-mm`)
3. `GetItem` plan: `PK=DOG#${dogId}, SK=PLAN#${month}`
4. If no plan and `planStatus=generating` → return `{ planStatus: 'generating' }`
5. If no plan → 404
6. `Query` activities: `PK=DOG#${dogId}, SK begins_with ACTIVITY#${month}`
7. Build `completedTexts = Set` of `completed_task` taskTexts from activities
8. Enrich `whatToDo` items: add `completed: completedTexts.has(item.text)`
9. Derive `monthLabel`: `"Month ${ageMonthsAtPlan} with ${dogName}"`
10. Return full journey response

**serverless.yml addition:**
```yaml
getMonthlyJourney:
  handler: src/functions/wellness/getMonthlyJourney.handler
  events:
    - httpApi: { path: /dogs/{dogId}/journey, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem, dynamodb:Query], Resource: [!GetAtt FurcircleTable.Arn, !Sub "${FurcircleTable.Arn}/index/*"] }
```

**Acceptance criteria:**
- [ ] `GET /dogs/{dogId}/journey` → 200 with full 4-pillar plan
- [ ] After `POST /activities` for a task, that task shows `completed: true` in journey
- [ ] `?month=` param returns the correct month's plan
- [ ] `?month=` for a month with no plan → 404
- [ ] `monthLabel` = "Month 3 with Buddy" (matches ageMonthsAtPlan + dog name)
- [ ] All 4 pillars present: `whatToDo`, `whatNotToDo`, `watchFor`, `earlyWarningSigns`
- [ ] 403 for another owner's dog

**Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/dogs/$DOG_ID/journey | jq '.whatToDo[0].completed'
# Should be true for tasks logged via P2-T1
```

---

## Task P2-T3 — Home Screen API

**What:** `GET /home` — single aggregated call that powers the mobile home screen. Most complex Phase 2 endpoint: 5 DynamoDB reads, CTA logic, action steps with completion status.

**Vertical slice:** Mobile client makes one call → gets everything for the home screen.

**New files:**
- `src/functions/wellness/getHomeScreen.ts`

**Logic (optimise for read performance — parallelise all reads):**
1. Extract `userId` from JWT, read `?dogId` query param
2. **Parallel read batch:**
   - `BatchGetItem`: `OWNER#${userId}/PROFILE` + `OWNER#${userId}/SUBSCRIPTION`
   - `Query` GSI1: `GSI1PK=OWNER#${userId}, GSI1SK begins_with DOG#` → get dog list
3. Resolve target dog: use `dogId` param if provided, else first dog from query
4. If no dog → return `{ owner, dog: null, plan: null, ctaBanners }`
5. **Parallel read batch 2:**
   - `GetItem` plan: `DOG#${dogId}/PLAN#${currentMonth}`
   - `Query` activities: `DOG#${dogId}/ACTIVITY#${currentMonth}*`
6. Build `completedTexts` set from activities
7. Build `actionSteps` from `plan.whatToDo` → mark `completed` flag
8. Build `pillSummaries`: `{ whatToDo: "${n} actions", ... }`
9. Build `ctaBanners`:
   - `subscription.plan === 'welcome'` or `'protector'` → show upgrade banner
10. Return assembled home screen response

**Key notes:**
- Use `Promise.all` for both parallel read batches
- If plan `planStatus=generating` → include `{ planStatus: 'generating' }` in plan field
- If no plan exists yet (brand new dog) → `plan: null`

**serverless.yml addition:**
```yaml
getHomeScreen:
  handler: src/functions/wellness/getHomeScreen.handler
  events:
    - httpApi: { path: /home, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - Effect: Allow
      Action: [dynamodb:GetItem, dynamodb:BatchGetItem, dynamodb:Query]
      Resource:
        - !GetAtt FurcircleTable.Arn
        - !Sub "${FurcircleTable.Arn}/index/*"
```

**Acceptance criteria:**
- [ ] `GET /home` → 200 with owner, dog, plan, actionSteps, ctaBanners all populated
- [ ] `GET /home?dogId=${id}` returns data for the specified dog
- [ ] Action steps have `completed: true` for logged activities
- [ ] `ctaBanners` shows upgrade banner for `welcome` plan owners
- [ ] No dog → `{ dog: null, plan: null }` (not an error)
- [ ] Plan still generating → `{ plan: { planStatus: 'generating' } }`
- [ ] Response time < 500ms (parallel reads, not sequential)
- [ ] 401 with no token

**Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/home | jq '.'
# Should show: owner, dog, plan with action steps, milestones, ctaBanners
# Time the request:
time curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/home -o /dev/null -s
```

---

## Task P2-T4 — Monthly Auto-Refresh (EventBridge)

**What:** `triggerMonthlyRefresh` Lambda fires on 1st of each month, fans out Step Functions executions for every dog that had a plan the previous month.

**Vertical slice:** Automatic monthly plan regeneration without any mobile client involvement.

**Prerequisite check:** Verify `savePlan` (Phase 1 Task 6) writes `GSI1PK=PLAN#${yyyy-mm}` on plan records. Without this, the GSI1 query returns no results.

**New files:**
- `src/functions/plan/triggerMonthlyRefresh.ts`

**Logic:**
1. Compute `prevMonth`: `yyyy-mm` of the previous calendar month
2. Query GSI1: `GSI1PK=PLAN#${prevMonth}` → returns all plan records from last month (paginated)
3. Extract `dogId` from each result (`GSI1SK = DOG#${dogId}`)
4. Batch into groups of 25
5. For each batch: `Promise.allSettled(dogIds.map(dogId => sfn.startExecution(...)))`
6. Log: total dogs processed, successes, failures
7. Return summary (EventBridge doesn't use the return value but log it)

**serverless.yml additions:**
```yaml
triggerMonthlyRefresh:
  handler: src/functions/plan/triggerMonthlyRefresh.handler
  timeout: 300  # 5 minutes for large dog counts
  events:
    - schedule:
        rate: cron(0 0 1 * ? *)
        enabled: true
  environment:
    STATE_MACHINE_ARN: !Sub arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:furcircle-generate-plan-${self:provider.stage}
  iamRoleStatements:
    - Effect: Allow
      Action: [dynamodb:Query]
      Resource: !Sub "${FurcircleTable.Arn}/index/GSI1"
    - Effect: Allow
      Action: [states:StartExecution]
      Resource: !Sub arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:furcircle-generate-plan-${self:provider.stage}
```

**Acceptance criteria:**
- [ ] Lambda deploys with EventBridge trigger visible in AWS console
- [ ] Manual invocation (`sls invoke -f triggerMonthlyRefresh`) processes all dogs with plans from prev month
- [ ] Step Function execution starts for each dog (visible in Step Functions console)
- [ ] `Promise.allSettled` — one failed execution doesn't block others
- [ ] Handles paginated GSI1 results (>1MB) correctly
- [ ] Logs dog count + success/failure counts to CloudWatch

**Verification:**
```bash
# Manual invoke (simulates EventBridge)
sls invoke -f triggerMonthlyRefresh --stage dev

# Check CloudWatch for log output
sls logs -f triggerMonthlyRefresh --stage dev

# Verify Step Functions started
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:<accountId>:stateMachine:furcircle-generate-plan-dev \
  --status-filter RUNNING
```

---

## Checkpoint — Phase 2 E2E Smoke Test

**When:** After all 4 tasks complete and deployed.

**Full flow:**
```
1.  Sign in as existing test owner (from Phase 1 E2E)
2.  GET /home → verify owner, dog, current plan, action steps, milestones, ctaBanners
3.  GET /dogs/{dogId}/journey → verify full 4-pillar plan with completed: false on all tasks
4.  POST /dogs/{dogId}/activities (completed_task for a training task)
5.  GET /dogs/{dogId}/activities → verify activity listed, completedCount=1
6.  GET /dogs/{dogId}/journey → verify that task now shows completed: true
7.  GET /home → verify action step shows completed: true, wellnessScore increased
8.  POST /dogs/{dogId}/activities (skipped_task for a health task) → verify score decreases
9.  GET /home?dogId=${id} → verify dogId param works
10. Invoke triggerMonthlyRefresh manually → verify Step Functions start in console
```

**Pass criteria:**
- [ ] All 10 steps succeed
- [ ] Wellness score changes correctly (+2 training, −1 health from steps 4+8)
- [ ] `GET /home` response time < 500ms consistently
- [ ] No Lambda errors in CloudWatch for any Phase 2 function
- [ ] EventBridge rule visible and enabled in AWS console
- [ ] Phase 2 integration tests all pass: `npm run test:integration`

---

## New Files Summary

| File | Purpose |
|------|---------|
| `src/lib/wellness.ts` | `assignCategory(text)`, `recalcScore(scores, category, type)`, `computeWellnessScore(scores)` |
| `src/functions/wellness/logActivity.ts` | `POST /dogs/{dogId}/activities` |
| `src/functions/wellness/getActivities.ts` | `GET /dogs/{dogId}/activities` |
| `src/functions/wellness/getMonthlyJourney.ts` | `GET /dogs/{dogId}/journey` |
| `src/functions/wellness/getHomeScreen.ts` | `GET /home` |
| `src/functions/plan/triggerMonthlyRefresh.ts` | EventBridge monthly fan-out |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `savePlan` missing GSI1PK → `triggerMonthlyRefresh` returns 0 dogs | Medium | High | Verify in Phase 1 Task 6 before P2-T4 |
| `GET /home` slow (sequential reads) | Medium | High | Use `Promise.all` for both read batches |
| Category keyword matching too aggressive (wrong category) | Low | Low | Default to `trainingBehaviour`; tunable in `wellness.ts` |
| EventBridge fires at midnight UTC → wrong month boundary | Low | Low | Always compute `prevMonth` from current date at invocation time |
| triggerMonthlyRefresh timeout at > 300 dogs | Very Low | Medium | Batch 25, `Promise.allSettled`, 5min Lambda timeout |

---
---

# FurCircle — Phase 4 Implementation Plan
# Booking System

## Reference Spec
`docs/spec-phase4-booking.md` + `docs/dynamodb-table-design.md`

**Prerequisite:** Phase 3 complete and deployed. `createThread` callable for post-booking follow-up threads (Phase 5 concern, but dependency must exist).

---

## Dependency Graph

```
Phase 3 complete (threads lib exists)
    │
    ▼
[P4-T1] Shared libs: src/lib/stripe.ts + src/lib/agora.ts
    │
    ├────────────────────────────────────┐
    ▼                                    ▼
[P4-T2] Subscription APIs          [P4-T4] Provider + Availability APIs
(getSubscriptionPlans,                   (listProviders, getProvider,
 createStripeCustomer,                    getProviderAvailability,
 subscribeToPlan,                         getProviderAssessment)
 cancelSubscription,                           │
 topUpCredits)                                 ▼
    │                               [P4-T5] Assessment APIs
    ▼                               (submitAssessment, getAssessment)
[P4-T3] Stripe Webhook                         │
(stripeWebhook)                                └────────┐
    │                                                    ▼
    └──────────────────────────────────────> [P4-T6] Booking CRUD
                                            (createBooking, listBookings,
                                             getBooking, cancelBooking)
                                                         │
                                                         ▼
                                                [P4-T7] Agora Token
                                                (getAgoraToken)
                                                         │
                                                         ▼
                                                [CHECKPOINT] E2E smoke test
```

---

## Pre-Build Decisions (resolve before P4-T1)

| # | Question | Recommendation | Decision |
|---|----------|---------------|----------|
| 1 | Stripe webhook owner lookup — email GSI or scan? | Use email from Stripe customer object → GSI1 `EMAIL#${email}` lookup. Scan is expensive and unbounded. | Confirm |
| 2 | Credits reset or rollover monthly? | Reset on `invoice.payment_succeeded` — simpler, aligns with Stripe billing cycle. | Confirm |
| 3 | Assessment: one-time per owner+vet forever? | One-time. Vet can initiate re-assessment if needed (Phase 5 vet API). | Confirm |
| 4 | Agora join window: ±30min configurable? | Fixed ±30 minutes for MVP. Make it an env var if product wants to tune. | Confirm |
| 5 | Credit top-up: PaymentIntent or Stripe Checkout? | PaymentIntent — mobile uses in-app payment sheet, no redirect needed. | Confirm |

---

## Task P4-T1 — Stripe + Agora Shared Libs

**What:** Install Stripe and Agora npm packages. Write shared lib wrappers that read secrets from SSM at Lambda cold start. No Lambda functions yet — just the shared foundation.

**Vertical slice:** Subsequent tasks can import `stripe.ts` and `agora.ts` without re-implementing SSM reads or SDK init.

**New files:**
- `src/lib/stripe.ts` — Stripe SDK singleton with lazy init
- `src/lib/agora.ts` — `generateRtcToken(channelName, uid, expirySeconds)` using `agora-token` package

**stripe.ts pattern:**
```typescript
import Stripe from 'stripe';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

let stripe: Stripe;

export async function getStripe(): Promise<Stripe> {
  if (stripe) return stripe;
  const ssm = new SSMClient({});
  const { Parameter } = await ssm.send(new GetParameterCommand({
    Name: `/furcircle/${process.env.STAGE}/stripe/secretKey`,
    WithDecryption: true,
  }));
  stripe = new Stripe(Parameter!.Value!, { apiVersion: '2024-06-20' });
  return stripe;
}
```

**agora.ts pattern:**
```typescript
import { RtcTokenBuilder, RtcRole } from 'agora-token';

export async function generateRtcToken(
  channelName: string,
  uid: number,
  expirySeconds: number
): Promise<{ token: string; appId: string }> {
  // Read appId + appCertificate from SSM at cold start (cached)
  const expireTime = Math.floor(Date.now() / 1000) + expirySeconds;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, expireTime
  );
  return { token, appId };
}
```

**package.json additions:**
- `stripe` — Stripe Node.js SDK
- `agora-token` — Agora RTC token builder

**serverless.yml additions:**
- `STAGE: ${self:provider.stage}` in provider environment (used by stripe.ts + agora.ts for SSM path)
- IAM for SSM `GetParameter` on `/furcircle/${stage}/stripe/*` and `/furcircle/${stage}/agora/*` for relevant Lambdas

**Acceptance criteria:**
- [ ] `npm install` completes — no missing peer deps for `stripe` or `agora-token`
- [ ] `sls deploy --stage dev` succeeds
- [ ] SSM params exist for all 4 keys (manual prerequisite — verify before deploy)
- [ ] `getStripe()` does not throw when called from a Lambda with correct IAM
- [ ] `generateRtcToken()` returns a non-empty string token

**Verification:**
```bash
npm install stripe agora-token
sls deploy --stage dev
# Verify SSM params exist
aws ssm get-parameter --name /furcircle/dev/stripe/secretKey --with-decryption
aws ssm get-parameter --name /furcircle/dev/agora/appId
```

---

## Task P4-T2 — Subscription Management APIs

**What:** Five subscription endpoints: plan catalogue (public), Stripe customer creation, subscribe, cancel, and credit top-up. All write to the `OWNER#${ownerId}/SUBSCRIPTION` record.

**Vertical slice:** Owner can view plans, create a Stripe customer, subscribe to the Proactive plan, and purchase credits — the full payment onboarding path.

**New files:**
- `src/functions/subscriptions/getSubscriptionPlans.ts`
- `src/functions/subscriptions/createStripeCustomer.ts`
- `src/functions/subscriptions/subscribeToPlan.ts`
- `src/functions/subscriptions/cancelSubscription.ts`
- `src/functions/subscriptions/topUpCredits.ts`

**getSubscriptionPlans logic:**
1. No DynamoDB read — return hardcoded plan catalogue from spec (welcome, protector, proactive)
2. `stripePriceId` values read from environment variables (set in serverless.yml per stage)

**createStripeCustomer logic:**
1. `GetItem` `OWNER#${userId}/PROFILE` → get email, firstName, lastName
2. `GetItem` `OWNER#${userId}/SUBSCRIPTION` → if `stripeCustomerId` already set, return it (idempotent)
3. `stripe.customers.create({ email, name: firstName + lastName, metadata: { userId } })`
4. `UpdateItem` SUBSCRIPTION: `SET stripeCustomerId=:id, updatedAt=:now`
5. Return `{ stripeCustomerId }`

**subscribeToPlan logic:**
1. `GetItem` SUBSCRIPTION → verify `stripeCustomerId` exists (400 if not — must call createStripeCustomer first)
2. Validate `planKey` is `protector` or `proactive`
3. `stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId })`
4. `stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: paymentMethodId } })`
5. `stripe.subscriptions.create({ customer, items: [{ price: stripePriceId }] })`
6. `UpdateItem` SUBSCRIPTION: plan, stripeSubscriptionId, status=active, currentPeriodEnd
7. If new plan is `proactive`: also `SET creditBalance=70`
8. Return plan, creditBalance, status, currentPeriodEnd

**cancelSubscription logic:**
1. `GetItem` SUBSCRIPTION → verify `stripeSubscriptionId` exists
2. `stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true })`
3. `UpdateItem` SUBSCRIPTION: `SET status=cancelling, updatedAt=:now`
4. Return `{ status: 'cancelling', cancelsAt: currentPeriodEnd }`

**topUpCredits logic:**
1. Validate `credits` is one of `[10, 20, 50]` → 400 `INVALID_CREDIT_PACKAGE` if not
2. Look up price: `{ 10: 1000, 20: 1800, 50: 4000 }` (cents)
3. `GetItem` SUBSCRIPTION → get `stripeCustomerId`
4. `stripe.paymentIntents.create({ amount, currency: 'usd', customer, payment_method, confirm: true, return_url: '' })`
5. On success: `UpdateItem` SUBSCRIPTION `ADD creditBalance :credits`
6. Return `{ creditBalance, creditsAdded }`

**Credit packages** (hardcoded):
```typescript
const CREDIT_PACKAGES: Record<number, number> = { 10: 1000, 20: 1800, 50: 4000 };
```

**serverless.yml additions:**
```yaml
getSubscriptionPlans:
  handler: src/functions/subscriptions/getSubscriptionPlans.handler
  events:
    - httpApi: { path: /subscriptions/plans, method: GET }

createStripeCustomer:
  handler: src/functions/subscriptions/createStripeCustomer.handler
  events:
    - httpApi: { path: /subscriptions/customer, method: POST, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem, dynamodb:UpdateItem], Resource: !GetAtt FurcircleTable.Arn }
    - { Effect: Allow, Action: [ssm:GetParameter], Resource: !Sub "arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/furcircle/${self:provider.stage}/stripe/*" }

# subscribeToPlan, cancelSubscription, topUpCredits follow same IAM pattern
```

**Acceptance criteria:**
- [ ] `GET /subscriptions/plans` (no token) → 200 with 3 plans matching spec shape
- [ ] `POST /subscriptions/customer` → 200 with stripeCustomerId; second call returns same ID (idempotent)
- [ ] `POST /subscriptions` (proactive) → 200 with plan=proactive, creditBalance=70, status=active
- [ ] `POST /subscriptions` for non-existent customer → 400 `STRIPE_CUSTOMER_REQUIRED`
- [ ] `DELETE /subscriptions` → 200 with status=cancelling, cancelsAt set
- [ ] `POST /subscriptions/credits/topup` with credits=20 → 200, creditBalance increases by 20
- [ ] `POST /subscriptions/credits/topup` with credits=7 → 400 `INVALID_CREDIT_PACKAGE`
- [ ] All endpoints return 401 with no/expired token (except getSubscriptionPlans)

**Verification:**
```bash
# No auth — plan catalogue
curl https://<api>/dev/subscriptions/plans | jq '.plans | length'  # must be 3

# Create Stripe customer
curl -X POST -H "Authorization: Bearer $TOKEN" https://<api>/dev/subscriptions/customer

# Subscribe to proactive
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"planKey":"proactive","paymentMethodId":"pm_card_visa"}' \
  https://<api>/dev/subscriptions

# Verify in DynamoDB
aws dynamodb get-item --table-name furcircle-dev \
  --key '{"PK":{"S":"OWNER#<userId>"},"SK":{"S":"SUBSCRIPTION"}}' | jq '.Item.plan.S'
```

---

## Task P4-T3 — Stripe Webhook

**What:** `POST /webhooks/stripe` — the only unauthenticated POST in the API (no Cognito). Verified via Stripe signature header. Handles four event types that keep DynamoDB in sync with Stripe subscription state.

**Vertical slice:** Stripe lifecycle events (payment success, failure, plan changes, cancellation) automatically reflect in owner's subscription record without any mobile client action.

**New files:**
- `src/functions/subscriptions/stripeWebhook.ts`

**Logic:**
1. Read raw body (required for Stripe signature verification — must not parse JSON first)
2. `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` → 400 on `StripeSignatureVerificationError`
3. Switch on `event.type`:

| Event | Action |
|-------|--------|
| `invoice.payment_succeeded` | Find owner by email → if plan=proactive: `SET creditBalance=70, updatedAt=now` |
| `invoice.payment_failed` | Find owner by email → `SET status=past_due` + SNS push |
| `customer.subscription.updated` | Find owner by stripeCustomerId → sync `plan, status, currentPeriodEnd` |
| `customer.subscription.deleted` | Find owner by stripeCustomerId → `SET plan=welcome, creditBalance=0, status=active` |

4. Always `return success({})` — errors logged to CloudWatch but never returned to Stripe (prevents retry storms)

**Owner lookup strategy:**
- For `invoice.*`: get `customer` ID from event → `stripe.customers.retrieve(customerId)` → use customer email → `Query GSI1: GSI1PK=EMAIL#${email}, GSI1SK=OWNER`
- For `customer.subscription.*`: same pattern

**serverless.yml addition:**
```yaml
stripeWebhook:
  handler: src/functions/subscriptions/stripeWebhook.handler
  events:
    - httpApi: { path: /webhooks/stripe, method: POST }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:Query, dynamodb:UpdateItem], Resource: [!GetAtt FurcircleTable.Arn, !Sub "${FurcircleTable.Arn}/index/*"] }
    - { Effect: Allow, Action: [ssm:GetParameter], Resource: !Sub "arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/furcircle/${self:provider.stage}/stripe/*" }
    - { Effect: Allow, Action: [sns:Publish], Resource: !Ref FurcircleNotificationsTopic }
```

**Critical note on raw body:** API Gateway HTTP API must pass the raw body to the Lambda for Stripe signature verification. In serverless.yml, ensure `isBase64Encoded` handling is correct or use a Lambda function URL instead.

**Acceptance criteria:**
- [ ] POST with invalid `stripe-signature` → 400 (Stripe will retry — use 400 not 500)
- [ ] `invoice.payment_succeeded` for proactive owner → creditBalance=70 in DynamoDB
- [ ] `invoice.payment_failed` → status=past_due in DynamoDB
- [ ] `customer.subscription.updated` → plan + currentPeriodEnd synced
- [ ] `customer.subscription.deleted` → plan=welcome, creditBalance=0 in DynamoDB
- [ ] Unknown event type → 200 (no-op, no error)

**Verification:**
```bash
# Install Stripe CLI, forward events to local/dev endpoint
stripe listen --forward-to https://<api>/dev/webhooks/stripe

# Trigger test events
stripe trigger invoice.payment_succeeded
stripe trigger customer.subscription.deleted

# Verify DynamoDB updated
aws dynamodb get-item --table-name furcircle-dev \
  --key '{"PK":{"S":"OWNER#<userId>"},"SK":{"S":"SUBSCRIPTION"}}' | jq '.Item'
```

---

## Task P4-T4 — Provider + Availability APIs

**What:** Four read-heavy endpoints for discovering and evaluating providers. `listProviders` is the most complex — it must enrich each vet with the authenticated owner's assessment status and booking eligibility.

**Vertical slice:** Owner can browse behaviourists and nutritionists, see who they've already assessed with, and determine who they can book.

**New files:**
- `src/functions/providers/listProviders.ts`
- `src/functions/providers/getProvider.ts`
- `src/functions/providers/getProviderAvailability.ts`
- `src/functions/providers/getProviderAssessment.ts`

**listProviders logic:**
1. Validate `type` query param → 400 `INVALID_PROVIDER_TYPE` if not `behaviourist` or `nutritionist`
2. `Query` GSI3: `GSI3PK=PROVIDER_TYPE#${type}`, `ScanIndexForward=false` (rating DESC via `RATING#4.9#VET#...` SK)
3. If no results → return `{ providers: [] }`
4. `Promise.all` for each vet: `Query GSI1: GSI1PK=OWNER#${userId}, GSI1SK=ASSESSMENT#${vetId}` → derive `assessmentStatus`
5. `GetItem` `OWNER#${userId}/SUBSCRIPTION` → get plan for `canBook` derivation
6. `canBook` logic:
   - behaviourist: `assessmentStatus === 'approved' && plan === 'proactive'`
   - nutritionist: `plan === 'proactive'` (no assessment needed)
7. Filter out `isActive=false` vets

**getProvider logic:**
1. `GetItem` `VET#${vetId}/PROFILE` → 404 if not found
2. `Promise.all`:
   - Query GSI1 for owner's assessment with this vet
   - Query vet availability: `PK=VET#${vetId}`, `SK begins_with AVAIL#` (limit 14, ScanIndexForward=true) → find first available date
3. Return full provider shape including `bio`, `availability.nextAvailable`

**getProviderAvailability logic:**
1. Validate `startDate` + `endDate` query params (both required)
2. Date range check: max 14 days → 400 `DATE_RANGE_TOO_LARGE` if exceeded
3. `Query` `PK=VET#${vetId}`, `SK between AVAIL#${startDate} and AVAIL#${endDate}`
4. For dates with no record, include `{ date, slots: [] }`
5. Return `{ vetId, availability: [...] }`

**getProviderAssessment logic:**
1. `Query` GSI1: `GSI1PK=OWNER#${userId}`, `GSI1SK=ASSESSMENT#${vetId}`
2. If no result → 404
3. Return assessment record

**serverless.yml additions (IAM pattern):**
```yaml
listProviders:
  iamRoleStatements:
    - Effect: Allow
      Action: [dynamodb:Query, dynamodb:GetItem]
      Resource:
        - !GetAtt FurcircleTable.Arn
        - !Sub "${FurcircleTable.Arn}/index/*"
```

**Acceptance criteria:**
- [ ] `GET /providers?type=behaviourist` → list sorted by rating DESC, each with `assessmentStatus` + `canBook`
- [ ] `GET /providers?type=behaviourist` for proactive owner with approved assessment → `canBook=true`
- [ ] `GET /providers?type=nutritionist` for proactive owner → `canBook=true` (no assessment required)
- [ ] `GET /providers` missing `type` → 400 `INVALID_PROVIDER_TYPE`
- [ ] `GET /providers/{vetId}` → 200 with bio + availability.nextAvailable
- [ ] `GET /providers/{vetId}` non-existent → 404
- [ ] `GET /providers/{vetId}/availability?startDate=2026-04-18&endDate=2026-04-25` → per-date slot arrays
- [ ] `GET /providers/{vetId}/availability` with > 14-day window → 400
- [ ] `GET /providers/{vetId}/assessment` → 404 if no assessment exists; 200 with assessment if it does

**Verification:**
```bash
# Requires seed vet records in DynamoDB with GSI3 keys set
curl -H "Authorization: Bearer $TOKEN" \
  "https://<api>/dev/providers?type=behaviourist" | jq '.providers[0].assessmentStatus'

curl -H "Authorization: Bearer $TOKEN" \
  "https://<api>/dev/providers/<vetId>/availability?startDate=2026-04-18&endDate=2026-04-25"
```

---

## Task P4-T5 — Assessment APIs

**What:** `POST /assessments` to submit a free behaviourist assessment and `GET /assessments/{assessmentId}` to poll its status. Gateway to behaviourist bookings.

**Vertical slice:** Owner submits a description and optional media, vet gets notified, owner can poll for approval.

**New files:**
- `src/functions/assessments/submitAssessment.ts`
- `src/functions/assessments/getAssessment.ts`

**submitAssessment logic:**
1. Validate body:
   - `vetId`: required
   - `dogId`: required — `GetItem` dog, verify `ownerId === userId` (403)
   - `description`: required, min 50 chars → 400 `DESCRIPTION_TOO_SHORT`
   - `mediaUrls`: optional, max 3 → 400 `TOO_MANY_MEDIA_URLS`; each must match `https://furcircle-*.s3.amazonaws.com/assessments/` → 400 `INVALID_MEDIA_URL`
2. `Query` GSI1: `GSI1PK=OWNER#${userId}`, `GSI1SK=ASSESSMENT#${vetId}` → if any result has `status=pending` or `status=approved` → 409 `ASSESSMENT_EXISTS`
3. Generate `assessmentId` (UUID)
4. `PutItem` ASSESSMENT record:
   - PK: `ASSESSMENT#${assessmentId}`, SK: `ASSESSMENT`
   - GSI1PK: `OWNER#${ownerId}`, GSI1SK: `ASSESSMENT#${vetId}`
   - GSI2PK: `VET#${vetId}`, GSI2SK: `ASSESSMENT#pending#${createdAt}`
5. try/catch: `SNS.publish()` push to vet (non-fatal — log and continue)
6. Return 201 `{ assessmentId, vetId, dogId, status: 'pending', createdAt }`

**getAssessment logic:**
1. `GetItem` `ASSESSMENT#${assessmentId}/ASSESSMENT` → 404 if not found
2. Verify `ownerId === userId` → 403 `FORBIDDEN`
3. Return full record including `vetResponse`, `reviewedAt` (null until reviewed)

**DynamoDB entity written:**
```
PK=ASSESSMENT#${assessmentId}
SK=ASSESSMENT
GSI1PK=OWNER#${ownerId}     GSI1SK=ASSESSMENT#${vetId}
GSI2PK=VET#${vetId}         GSI2SK=ASSESSMENT#pending#${createdAt}
```

**serverless.yml additions:**
```yaml
submitAssessment:
  handler: src/functions/assessments/submitAssessment.handler
  events:
    - httpApi: { path: /assessments, method: POST, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem, dynamodb:Query, dynamodb:PutItem], Resource: [!GetAtt FurcircleTable.Arn, !Sub "${FurcircleTable.Arn}/index/*"] }
    - { Effect: Allow, Action: [sns:Publish], Resource: !Ref FurcircleNotificationsTopic }

getAssessment:
  handler: src/functions/assessments/getAssessment.handler
  events:
    - httpApi: { path: /assessments/{assessmentId}, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem], Resource: !GetAtt FurcircleTable.Arn }
```

**Acceptance criteria:**
- [ ] `POST /assessments` with valid body → 201, ASSESSMENT record in DynamoDB with `status=pending`
- [ ] `POST /assessments` with description < 50 chars → 400 `DESCRIPTION_TOO_SHORT`
- [ ] `POST /assessments` with > 3 mediaUrls → 400 `TOO_MANY_MEDIA_URLS`
- [ ] `POST /assessments` with invalid S3 URL pattern → 400 `INVALID_MEDIA_URL`
- [ ] `POST /assessments` for same owner+vet (pending exists) → 409 `ASSESSMENT_EXISTS`
- [ ] `POST /assessments` for another owner's dog → 403
- [ ] `GET /assessments/{id}` → 200 with full record
- [ ] `GET /assessments/{id}` for another owner's assessment → 403

**Verification:**
```bash
# Submit assessment
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"vetId":"<vetId>","dogId":"<dogId>","description":"Buddy has been showing separation anxiety for 3 months since we moved. He barks constantly when left alone."}' \
  https://<api>/dev/assessments

# Poll status
ASSESSMENT_ID=<returned assessmentId>
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/assessments/$ASSESSMENT_ID
```

---

## Task P4-T6 — Booking CRUD

**What:** Four booking endpoints. `createBooking` is the most critical — it atomically deducts credits using a DynamoDB ConditionExpression to prevent double-spend races.

**Vertical slice:** Owner with proactive plan + approved assessment (for behaviourist) can book, manage, and cancel video consultations.

**New files:**
- `src/functions/bookings/createBooking.ts`
- `src/functions/bookings/listBookings.ts`
- `src/functions/bookings/getBooking.ts`
- `src/functions/bookings/cancelBooking.ts`

**createBooking logic (order matters — fail fast):**
1. Validate body: `duration` must be 15 or 30; `scheduledAt` must be a future ISO datetime
2. `GetItem` `OWNER#${userId}/SUBSCRIPTION`:
   - plan ≠ `proactive` → 403 `UPGRADE_REQUIRED`
   - `creditBalance < duration` → 402 `INSUFFICIENT_CREDITS`
3. `GetItem` `VET#${vetId}/PROFILE` → 404 if not found
4. If vet `providerType === 'behaviourist'`:
   - `assessmentId` required → 400 if missing
   - `GetItem` `ASSESSMENT#${assessmentId}/ASSESSMENT` → verify `status=approved` → 400 `ASSESSMENT_REQUIRED`
5. `GetItem` availability: `VET#${vetId}/AVAIL#${date}` → find slot matching `scheduledAt.time` → 409 `SLOT_UNAVAILABLE` if `available=false`
6. **Atomic credit deduction:**
   ```
   UpdateItem OWNER#${userId}/SUBSCRIPTION
   SET creditBalance = creditBalance - :cost, updatedAt = :now
   CONDITION creditBalance >= :cost
   ```
   If `ConditionalCheckFailedException` → 402 `INSUFFICIENT_CREDITS`
7. `UpdateItem` vet availability: mark slot `available=false`
8. Generate `bookingId` (UUID)
9. `PutItem` BOOKING record with `GSI1SK=BOOKING#upcoming#${scheduledAt}` and `GSI2SK=BOOKING#upcoming#${scheduledAt}`
10. try/catch: SNS push to vet + owner (non-fatal)
11. Return 201 with booking + vet profile snippet + credits remaining

**Key design:** Steps 1–5 are read-only checks. Step 6 is the atomic write. Even if steps 1–5 pass, step 6 re-validates credit balance atomically — prevents double-booking in concurrent requests.

**listBookings logic:**
1. `status` param: `upcoming` → SK prefix `BOOKING#upcoming`; `past` → query both `BOOKING#completed` and `BOOKING#cancelled`; no param → `BOOKING#` (all)
2. `Query` GSI1: `GSI1PK=OWNER#${userId}`, `GSI1SK begins_with BOOKING#${prefix}`
3. Extract `vetId` + `dogId` from each booking
4. Single `BatchGetItem` for all distinct vets + dogs
5. Merge vet/dog profiles into each booking item
6. Return `{ bookings, nextToken? }`

**getBooking logic:**
1. `GetItem` `BOOKING#${bookingId}/BOOKING` → 404 if not found
2. `ownerId === userId` → 403 if mismatch
3. Return full booking including `agoraChannelId`, `postCallSummary`

**cancelBooking logic:**
1. `GetItem` booking → 404 if not found; 403 if not owner; 400 if `status ≠ upcoming`
2. Compute: `now < scheduledAt - 24h` → full refund eligible
3. `UpdateItem` booking: `SET status=cancelled, updatedAt=:now`
4. If refund: `UpdateItem` SUBSCRIPTION `ADD creditBalance :cost`
5. `UpdateItem` vet availability: restore slot `available=true`
6. try/catch: SNS push to vet (non-fatal)
7. Return `{ bookingId, status: 'cancelled', creditsRefunded, creditBalance }`

**serverless.yml additions:**
```yaml
createBooking:
  handler: src/functions/bookings/createBooking.handler
  events:
    - httpApi: { path: /bookings, method: POST, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - Effect: Allow
      Action: [dynamodb:GetItem, dynamodb:UpdateItem, dynamodb:PutItem]
      Resource: !GetAtt FurcircleTable.Arn
    - { Effect: Allow, Action: [sns:Publish], Resource: !Ref FurcircleNotificationsTopic }

listBookings:
  handler: src/functions/bookings/listBookings.handler
  events:
    - httpApi: { path: /bookings, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - Effect: Allow
      Action: [dynamodb:Query, dynamodb:BatchGetItem]
      Resource: [!GetAtt FurcircleTable.Arn, !Sub "${FurcircleTable.Arn}/index/*"]

# getBooking: GetItem only
# cancelBooking: GetItem + UpdateItem (x3) + sns:Publish
```

**Acceptance criteria:**
- [ ] `POST /bookings` (valid proactive + approved assessment) → 201, BOOKING in DynamoDB, creditBalance deducted
- [ ] `POST /bookings` with plan ≠ proactive → 403 `UPGRADE_REQUIRED`
- [ ] `POST /bookings` with creditBalance < duration → 402 `INSUFFICIENT_CREDITS`
- [ ] `POST /bookings` for behaviourist without approved assessment → 400 `ASSESSMENT_REQUIRED`
- [ ] `POST /bookings` on taken slot → 409 `SLOT_UNAVAILABLE`
- [ ] Concurrent `POST /bookings` by two users for same slot → only one succeeds (ConditionExpression enforces atomicity)
- [ ] `GET /bookings?status=upcoming` → only upcoming bookings, with vet + dog names
- [ ] `GET /bookings/{id}` → 200 with full booking; 403 for wrong owner
- [ ] `DELETE /bookings/{id}` (> 24h before) → status=cancelled, credits refunded
- [ ] `DELETE /bookings/{id}` (≤ 24h before) → status=cancelled, no credit refund
- [ ] `DELETE /bookings/{id}` for already-cancelled booking → 400

**Verification:**
```bash
# Create booking (requires proactive plan + approved assessment + available slot)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"vetId":"<vetId>","dogId":"<dogId>","assessmentId":"<assessmentId>","duration":30,"scheduledAt":"2026-05-01T10:00:00Z"}' \
  https://<api>/dev/bookings

# Verify credits deducted
aws dynamodb get-item --table-name furcircle-dev \
  --key '{"PK":{"S":"OWNER#<userId>"},"SK":{"S":"SUBSCRIPTION"}}' | jq '.Item.creditBalance.N'

# Cancel (> 24h before)
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://<api>/dev/bookings/$BOOKING_ID
```

---

## Task P4-T7 — Agora Token

**What:** `GET /bookings/{bookingId}/token` — generates a short-lived Agora RTC token for joining the video call. Both the booking owner and the assigned vet can call this endpoint.

**Vertical slice:** Video call participants can join the Agora channel at the scheduled time.

**New files:**
- `src/functions/bookings/getAgoraToken.ts`

**Logic:**
1. `GetItem` `BOOKING#${bookingId}/BOOKING` → 404 if not found
2. Auth check: `userId === booking.ownerId || userId === booking.vetId` → 403 `FORBIDDEN` if neither
3. Verify `booking.status === 'upcoming'` → 400 `BOOKING_NOT_UPCOMING`
4. Compute join window: `scheduledAt - 30min ≤ now ≤ scheduledAt + 30min` → 403 `TOO_EARLY` if before window
5. Compute deterministic UID from userId:
   ```typescript
   function toUid(userId: string): number {
     let hash = 0;
     for (const c of userId) hash = (Math.imul(31, hash) + c.charCodeAt(0)) >>> 0;
     return hash >>> 0;  // uint32
   }
   ```
6. Call `generateRtcToken(booking.agoraChannelId, uid, 3600)`
7. Return `{ token, channelId, uid, appId, expiresAt: scheduledAt + 3600s }`

**serverless.yml addition:**
```yaml
getAgoraToken:
  handler: src/functions/bookings/getAgoraToken.handler
  events:
    - httpApi: { path: /bookings/{bookingId}/token, method: GET, authorizer: cognitoAuthorizer }
  iamRoleStatements:
    - { Effect: Allow, Action: [dynamodb:GetItem], Resource: !GetAtt FurcircleTable.Arn }
    - { Effect: Allow, Action: [ssm:GetParameter], Resource: !Sub "arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/furcircle/${self:provider.stage}/agora/*" }
```

**Acceptance criteria:**
- [ ] `GET /bookings/{id}/token` as booking owner (within ±30min window) → 200 with non-empty Agora token
- [ ] `GET /bookings/{id}/token` as assigned vet → 200 (same as owner)
- [ ] `GET /bookings/{id}/token` as different user → 403 `FORBIDDEN`
- [ ] `GET /bookings/{id}/token` more than 30min before `scheduledAt` → 403 `TOO_EARLY`
- [ ] `GET /bookings/{id}/token` for a `completed` booking → 400 `BOOKING_NOT_UPCOMING`
- [ ] UID is deterministic — same userId always produces same uint32

**Verification:**
```bash
# Within 30 min of scheduled time
curl -H "Authorization: Bearer $TOKEN" https://<api>/dev/bookings/$BOOKING_ID/token | jq '.'
# token should be a non-empty string starting with "006..."
# uid should be consistent across calls for the same userId
```

---

## Checkpoint — Phase 4 E2E Smoke Test

**When:** After all 7 tasks complete and deployed.

**Full flow:**
```
1.  GET /subscriptions/plans (no auth) → verify 3 plans + correct prices
2.  POST /subscriptions/customer → verify stripeCustomerId in DynamoDB
3.  POST /subscriptions (proactive, test card) → verify plan=proactive, creditBalance=70
4.  GET /providers?type=behaviourist → verify list with assessmentStatus=none, canBook=false
5.  POST /assessments → verify 201, status=pending in DynamoDB
6.  GET /providers?type=behaviourist → verify assessmentStatus=pending for that vet
7.  (Manually approve assessment in DynamoDB) → set status=approved
8.  GET /providers?type=behaviourist → verify assessmentStatus=approved, canBook=true
9.  GET /providers/{vetId}/availability?startDate=... → find an open slot
10. POST /bookings → verify 201, agoraChannelId set, creditBalance=40 (70-30)
11. GET /bookings?status=upcoming → verify booking listed with vet name
12. GET /bookings/{id}/token (within ±30min) → verify valid Agora token
13. DELETE /bookings/{id} → verify status=cancelled, creditBalance=70 (refunded, > 24h)
14. POST /webhooks/stripe invoice.payment_succeeded → verify creditBalance reset to 70
15. POST /webhooks/stripe customer.subscription.deleted → verify plan=welcome, creditBalance=0
```

**Pass criteria:**
- [ ] All 15 steps succeed without errors
- [ ] Atomic credit deduction prevents double-spend (concurrent booking test)
- [ ] Stripe webhook verified with valid signature via Stripe CLI
- [ ] Agora token accepted by Agora SDK in a test client (or valid token structure)
- [ ] No Lambda errors in CloudWatch for any Phase 4 function
- [ ] Sign off Phase 4 ✅ → begin Phase 5 planning

---

## New Files Summary

| File | Purpose |
|------|---------|
| `src/lib/stripe.ts` | Stripe SDK singleton with SSM-based key loading |
| `src/lib/agora.ts` | `generateRtcToken(channel, uid, expiry)` |
| `src/functions/subscriptions/getSubscriptionPlans.ts` | GET /subscriptions/plans (public) |
| `src/functions/subscriptions/createStripeCustomer.ts` | POST /subscriptions/customer |
| `src/functions/subscriptions/subscribeToPlan.ts` | POST /subscriptions |
| `src/functions/subscriptions/cancelSubscription.ts` | DELETE /subscriptions |
| `src/functions/subscriptions/topUpCredits.ts` | POST /subscriptions/credits/topup |
| `src/functions/subscriptions/stripeWebhook.ts` | POST /webhooks/stripe |
| `src/functions/providers/listProviders.ts` | GET /providers |
| `src/functions/providers/getProvider.ts` | GET /providers/{vetId} |
| `src/functions/providers/getProviderAvailability.ts` | GET /providers/{vetId}/availability |
| `src/functions/providers/getProviderAssessment.ts` | GET /providers/{vetId}/assessment |
| `src/functions/assessments/submitAssessment.ts` | POST /assessments |
| `src/functions/assessments/getAssessment.ts` | GET /assessments/{assessmentId} |
| `src/functions/bookings/createBooking.ts` | POST /bookings |
| `src/functions/bookings/listBookings.ts` | GET /bookings |
| `src/functions/bookings/getBooking.ts` | GET /bookings/{bookingId} |
| `src/functions/bookings/cancelBooking.ts` | DELETE /bookings/{bookingId} |
| `src/functions/bookings/getAgoraToken.ts` | GET /bookings/{bookingId}/token |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Concurrent bookings race on same slot | Medium | High | DynamoDB ConditionExpression on creditBalance + re-read slot before commit |
| Stripe webhook raw body mangled by API Gateway | Medium | High | Use `isBase64Encoded` check; test with Stripe CLI before prod |
| Owner lookup in webhook fails (no GSI1 EMAIL match) | Low | High | Log customer ID on failure; alert on CloudWatch; consider fallback scan |
| Agora token generation fails (bad cert/appId) | Low | High | Validate SSM params at deploy time with a smoke test invoke |
| Credit deduction succeeds but PutItem booking fails | Very Low | High | Use a DynamoDB transaction (TransactWrite) for step 6+8+9 if consistency is critical |
| Assessment duplicate race (two concurrent POST /assessments) | Low | Medium | PutItem with ConditionExpression `attribute_not_exists(PK)` on assessment |
| Stripe test cards rejected in dev | Low | Low | Use Stripe test card numbers (`4242424242424242`) in all smoke tests |
