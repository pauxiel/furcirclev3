# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FurCircle — AI-powered monthly wellness plans for dog owners. Backend only (React Native app is a separate repo). Phase 1 scope: auth, onboarding, dog CRUD, AI plan generation.

## Commands

```bash
# Install dependencies
npm install

# Deploy to dev
sls deploy --stage dev

# Deploy a single function (faster iteration)
sls deploy function -f createDog --stage dev

# Invoke a function locally (pass event JSON)
sls invoke local -f postConfirmation --path events/postConfirmation.json --stage dev

# Invoke deployed function
sls invoke -f createDog --stage dev --data '{"dogId":"test"}'

# View logs (tail)
sls logs -f createDog --stage dev --tail

# Remove stack
sls remove --stage dev
```

## Architecture

### Request flow

```
Mobile client
  → API Gateway HTTP API (JWT authorizer — Cognito idToken)
  → Lambda function
  → DynamoDB (single table)
```

Dog creation triggers an async Step Functions execution:
```
createDog Lambda → sfn.startExecution()
  → ValidateInput Lambda
  → CallClaude Lambda (Anthropic claude-opus-4-6)
  → SavePlan Lambda → DynamoDB PLAN record + dog planStatus=ready
  → NotifyPlanReady Lambda → SNS push notification
```

Cognito post-confirmation trigger (not HTTP):
```
User confirms email → Cognito fires postConfirmation Lambda
  → writes OWNER#${sub}/PROFILE + OWNER#${sub}/SUBSCRIPTION to DynamoDB
  → AdminAddUserToGroup → owners
```

### Shared lib helpers (`src/lib/`)

| File | Purpose |
|------|---------|
| `dynamodb.js` | DynamoDB DocumentClient singleton |
| `s3.js` | S3 client + `getPresignedPutUrl(bucket, key, contentType, expiresIn)` |
| `claude.js` | Anthropic SDK wrapper — `generatePlan(dogProfile)` reads API key from SSM at cold start |
| `response.js` | `success(data, statusCode)` and `error(code, message, statusCode)` — all Lambda responses go through these |
| `auth.js` | `getUserId(event)` — extracts Cognito sub from `event.requestContext.authorizer.jwt.claims.sub` |

### DynamoDB single-table key patterns

Table: `furcircle-${stage}`. All reads/writes use `@aws-sdk/lib-dynamodb` DocumentClient.

| Entity | PK | SK |
|--------|----|----|
| Owner profile | `OWNER#${userId}` | `PROFILE` |
| Subscription | `OWNER#${ownerId}` | `SUBSCRIPTION` |
| Dog profile | `DOG#${dogId}` | `PROFILE` |
| Health record | `DOG#${dogId}` | `HEALTH#${type}#${recordId}` |
| AI monthly plan | `DOG#${dogId}` | `PLAN#${yyyy-mm}` |
| Message thread | `THREAD#${threadId}` | `METADATA` |
| Message | `THREAD#${threadId}` | `MSG#${epochMs}#${messageId}` |
| Booking | `BOOKING#${bookingId}` | `BOOKING` |

GSIs:
- **GSI1** (`GSI1PK` / `GSI1SK`): owner → their dogs/bookings/threads. Dog: `GSI1PK=OWNER#${ownerId}`, `GSI1SK=DOG#${dogId}`
- **GSI2** (`GSI2PK` / `GSI2SK`): vet → their bookings/assessments/threads
- **GSI3** (`GSI3PK` / `GSI3SK`): provider type listing sorted by rating

Status is embedded in SK where filtering by status is needed (e.g. `BOOKING#upcoming#${scheduledAt}`) — avoids FilterExpression on Query.

### Ownership enforcement

Every dog endpoint must verify `dog.ownerId === userId` from JWT claims. Return 403 `FORBIDDEN` on mismatch. Use `GetItem` first, check ownership, then proceed.

### planStatus lifecycle

`generating` (set on POST /dogs) → `ready` (set by savePlan Lambda) or `failed` (set by handlePlanError Lambda).

`GET /dogs/{dogId}/plan` returns `{ planStatus: 'generating' }` (200) when plan not yet ready, 404 when no plan record exists.

### Anthropic API key

Stored in SSM: `/furcircle/${stage}/anthropic/apiKey`. Read at Lambda cold start in `src/lib/claude.js`. Model: `claude-opus-4-6`. Prompt must request pure JSON — strip any markdown code fences before `JSON.parse`.

### Dog photo upload flow

`POST /dogs/{dogId}/photo` → presigned S3 PUT URL (300s expiry, key: `dogs/${dogId}/profile.{ext}`) → mobile PUTs image directly to S3 → mobile calls `PUT /dogs/{dogId}` with `{ photoUrl }` to save URL.

## Key specs

- `docs/spec-phase1-auth-onboarding.md` — Lambda functions, API contracts, IAM per Lambda, error codes
- `docs/dynamodb-table-design.md` — full entity definitions, all GSIs, all access patterns
- `tasks/plan.md` — dependency graph, task breakdown, acceptance criteria
- `tasks/todo.md` — checklist to track progress
