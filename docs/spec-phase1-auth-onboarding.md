# FurCircle — Phase 1 Spec: Auth + Onboarding

## Scope

Build the foundation everything else runs on:
- Cognito User Pool (owners + vets groups, one pool)
- Owner sign-up → post-confirmation Lambda creates owner profile + default subscription
- Dog profile creation → triggers AI plan generation via Step Function
- Presigned S3 URL for dog photo upload
- All API endpoints behind Cognito JWT authorizer

Phase 1 does NOT include: Stripe, bookings, messaging, vet-facing APIs. Those are Phases 3–5.

---

## AWS Resources

### Cognito User Pool — `furcircle-users`

| Setting                   | Value                                    |
|---------------------------|------------------------------------------|
| Region                    | us-east-1                                |
| Sign-in method            | Email                                    |
| Auto-verify email         | Yes (sends OTP code)                     |
| Required attributes       | `email`, `given_name`, `family_name`     |
| Password policy           | Min 8 chars, uppercase, lowercase, digit |
| MFA                       | Off (optional for future)               |
| User groups               | `owners`, `vets`                         |
| App client name           | `furcircle-app`                          |
| App client secret         | None (mobile client)                     |
| Auth flows                | `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` |
| Lambda trigger            | Post Confirmation → `postConfirmation`  |

### S3 Bucket — `furcircle-dog-photos-{stage}`

| Setting              | Value                                        |
|----------------------|----------------------------------------------|
| Access               | Private (no public access)                  |
| CORS                 | Allow PUT from any origin (mobile upload)   |
| Presigned URL expiry | 300 seconds (5 minutes)                     |
| Key pattern          | `dogs/{dogId}/profile.{ext}`                |
| Lifecycle            | None for now                                |

### DynamoDB Table — `furcircle`

See `dynamodb-table-design.md` for full schema. Phase 1 uses:
- Owner Profile entity
- Subscription entity
- Dog Profile entity
- Health Record entity
- AI Monthly Plan entity

### Step Functions State Machine — `furcircle-generate-plan`

Used to generate the AI monthly plan after dog creation. Runs async so the mobile client
doesn't wait on the Lambda timeout.

States:
1. `ValidateInput` — Lambda: verify dogId exists, pull breed + ageMonths
2. `CallClaude` — Lambda: call Claude API, receive 4-pillar plan + wellness score + milestones
3. `SavePlan` — Lambda: write PLAN record to DynamoDB, update dog's `wellnessScore` + `planStatus=ready`
4. `NotifyUser` — Lambda: send push notification "Buddy's plan is ready 🐾"

On failure: update `planStatus=failed`, send push notification to retry.

---

## Lambda Functions

All functions: Node.js 20.x, 256 MB memory, 30s timeout unless noted.

| Function             | Trigger               | Purpose                                          |
|----------------------|-----------------------|--------------------------------------------------|
| `postConfirmation`   | Cognito Post Confirm  | Create OWNER record + SUBSCRIPTION (Welcome)    |
| `getMe`              | GET /owners/me        | Return owner profile + subscription             |
| `updateMe`           | PUT /owners/me        | Update firstName, lastName, pushToken           |
| `createDog`          | POST /dogs            | Create dog + health records + trigger plan gen  |
| `listDogs`           | GET /dogs             | List all dogs for the authenticated owner       |
| `getDog`             | GET /dogs/{dogId}     | Get dog profile + current month plan summary    |
| `updateDog`          | PUT /dogs/{dogId}     | Update dog profile fields                       |
| `getDogPhotoUrl`     | POST /dogs/{dogId}/photo | Return presigned S3 URL for photo upload    |
| `getCurrentPlan`     | GET /dogs/{dogId}/plan   | Get full current month plan                 |
| `validateInput`      | Step Function step    | Pull + validate dog data for plan generation    |
| `callClaude`         | Step Function step    | Generate plan via Claude API                    |
| `savePlan`           | Step Function step    | Persist plan to DynamoDB                        |
| `notifyPlanReady`    | Step Function step    | Send push notification via SNS                  |

---

## API Endpoints

Base URL: `https://{apiId}.execute-api.us-east-1.amazonaws.com/{stage}`

All endpoints require `Authorization: Bearer {Cognito idToken}` header unless marked public.
All responses: `Content-Type: application/json`.

---

### POST /owners/me — handled by Cognito Post Confirmation trigger

Not an HTTP endpoint. Fires automatically after email confirmation.

**Trigger input (Cognito event):**
```json
{
  "userName": "cognito-uuid",
  "request": {
    "userAttributes": {
      "sub": "cognito-uuid",
      "email": "joshua@example.com",
      "given_name": "Joshua",
      "family_name": "Smith"
    }
  }
}
```

**Lambda actions:**
1. Generate referral code (6-char alphanumeric, unique)
2. Write `OWNER#${sub} / PROFILE` to DynamoDB
3. Write `OWNER#${sub} / SUBSCRIPTION` with `plan=welcome, creditBalance=0`
4. Add user to `owners` Cognito group

**Response:** Return event unchanged (Cognito requirement).

---

### GET /owners/me

Returns the authenticated owner's profile and current subscription.

**Response 200:**
```json
{
  "userId": "cognito-uuid",
  "firstName": "Joshua",
  "lastName": "Smith",
  "email": "joshua@example.com",
  "pushToken": null,
  "referralCode": "FUR4X2",
  "subscription": {
    "plan": "welcome",
    "creditBalance": 0,
    "status": "active",
    "currentPeriodEnd": null
  },
  "createdAt": "2026-04-15T10:00:00Z"
}
```

---

### PUT /owners/me

Update owner profile fields. All fields optional.

**Request body:**
```json
{
  "firstName": "Josh",
  "lastName": "Smith",
  "pushToken": "ExponentPushToken[xxxx]"
}
```

**Response 200:**
```json
{
  "userId": "cognito-uuid",
  "firstName": "Josh",
  "lastName": "Smith",
  "email": "joshua@example.com",
  "pushToken": "ExponentPushToken[xxxx]",
  "updatedAt": "2026-04-15T11:00:00Z"
}
```

---

### POST /dogs

Create a dog profile and trigger AI plan generation.

**Request body:**
```json
{
  "name": "Buddy",
  "breed": "Golden Retriever",
  "ageMonths": 3,
  "adoptedFromShelter": false,
  "spayedNeutered": "not_yet",
  "medicalConditions": "None known",
  "additionalNotes": "On puppy food, no allergies",
  "environment": "Apartment, no other pets"
}
```

**Validation:**
- `name`: required, 1–50 chars
- `breed`: required, must be in breed list (or free text if not matched)
- `ageMonths`: required, 0–240
- `spayedNeutered`: required, one of `yes` / `no` / `not_yet`

**Lambda actions:**
1. Generate `dogId` (UUID)
2. Derive `dateOfBirth` from `ageMonths` (approximate: today minus N months)
3. Write `DOG#${dogId} / PROFILE` with `planStatus=generating`
4. If `spayedNeutered` or `medicalConditions` provided, write `HEALTH#` records
5. Start Step Function execution async: pass `{ dogId, breed, ageMonths, medicalConditions, environment }`
6. Return immediately (do not wait for plan)

**Response 201:**
```json
{
  "dogId": "uuid",
  "name": "Buddy",
  "breed": "Golden Retriever",
  "ageMonths": 3,
  "planStatus": "generating",
  "createdAt": "2026-04-15T10:00:00Z"
}
```

**Note for mobile:** Poll `GET /dogs/{dogId}` until `planStatus=ready` (or use push notification).

---

### GET /dogs

List all dogs for the authenticated owner.

**Response 200:**
```json
{
  "dogs": [
    {
      "dogId": "uuid",
      "name": "Buddy",
      "breed": "Golden Retriever",
      "ageMonths": 3,
      "photoUrl": "https://...",
      "wellnessScore": 72,
      "planStatus": "ready"
    }
  ]
}
```

---

### GET /dogs/{dogId}

Get full dog profile. Returns 403 if the dog does not belong to the authenticated owner.

**Response 200:**
```json
{
  "dogId": "uuid",
  "ownerId": "cognito-uuid",
  "name": "Buddy",
  "breed": "Golden Retriever",
  "ageMonths": 3,
  "dateOfBirth": "2026-01-15",
  "photoUrl": "https://...",
  "adoptedFromShelter": false,
  "spayedNeutered": "not_yet",
  "medicalConditions": "None known",
  "additionalNotes": "On puppy food",
  "environment": "Apartment, no other pets",
  "wellnessScore": 72,
  "planStatus": "ready",
  "healthRecords": [
    {
      "recordId": "uuid",
      "type": "vaccination",
      "title": "Vaccinations",
      "notes": "Next due May 15, 2026",
      "dueDate": "2026-05-15"
    }
  ],
  "createdAt": "2026-04-15T10:00:00Z",
  "updatedAt": "2026-04-15T10:30:00Z"
}
```

---

### PUT /dogs/{dogId}

Update dog profile. Returns 403 if dog does not belong to the authenticated owner.

**Request body** (all optional):
```json
{
  "name": "Buddy",
  "breed": "Golden Retriever",
  "ageMonths": 4,
  "adoptedFromShelter": false,
  "spayedNeutered": "yes",
  "medicalConditions": "Hip dysplasia",
  "additionalNotes": "Now on adult food",
  "environment": "House with garden"
}
```

**Response 200:** Updated dog object (same shape as GET /dogs/{dogId}).

---

### POST /dogs/{dogId}/photo

Returns a presigned S3 URL. The mobile client PUTs the image directly to S3 using this URL,
then calls PUT /dogs/{dogId} with the resulting `photoUrl`.

**Request body:**
```json
{
  "contentType": "image/jpeg"
}
```

**Validation:** `contentType` must be `image/jpeg` or `image/png`.

**Response 200:**
```json
{
  "uploadUrl": "https://furcircle-dog-photos-prod.s3.amazonaws.com/dogs/uuid/profile.jpg?X-Amz-Signature=...",
  "photoUrl": "https://furcircle-dog-photos-prod.s3.amazonaws.com/dogs/uuid/profile.jpg",
  "expiresIn": 300
}
```

**Mobile flow:**
1. Call `POST /dogs/{dogId}/photo` → get `uploadUrl`
2. `PUT {uploadUrl}` with raw image bytes + `Content-Type: image/jpeg`
3. Call `PUT /dogs/{dogId}` with `{ photoUrl }` to save the URL to the profile

---

### GET /dogs/{dogId}/plan

Get the current month's AI plan for a dog.

**Response 200 (plan ready):**
```json
{
  "dogId": "uuid",
  "month": "2026-04",
  "ageMonthsAtPlan": 3,
  "whatToExpect": "Your Golden Retriever is at peak learning capacity...",
  "whatToDo": [
    { "text": "Teach sit, come, down and stay using positive reinforcement. Five-minute sessions three times daily.", "videoUrl": "https://..." },
    { "text": "Begin leash introduction in the garden. Short calm sessions only." }
  ],
  "whatNotToDo": [
    { "text": "Don't take to off-leash dog parks — not fully vaccinated." },
    { "text": "Avoid rough play with large dogs." }
  ],
  "watchFor": [
    { "text": "Excessive hiding when meeting new people." }
  ],
  "earlyWarningSigns": [
    { "text": "Persistent limping", "action": "See a vet immediately." },
    { "text": "Loss of appetite for more than 24 hours", "action": "Contact your vet." }
  ],
  "comingUpNextMonth": "Month 4 focuses on adolescence boundaries and recall training.",
  "milestones": [
    { "emoji": "🐾", "title": "Socialisation window closing soon", "description": "Most critical period ends at 16 weeks. Prioritise new experiences." },
    { "emoji": "🎓", "title": "Basic commands this month", "description": "Sit, come, down, stay. Five-minute sessions, three times daily." },
    { "emoji": "🦷", "title": "Bite inhibition training", "description": "Mouthing at 3 months must be addressed before it becomes a real problem." }
  ],
  "wellnessScore": 72,
  "generatedAt": "2026-04-15T10:30:00Z"
}
```

**Response 200 (plan generating):**
```json
{
  "dogId": "uuid",
  "month": "2026-04",
  "planStatus": "generating"
}
```

**Response 404:** No plan exists for this dog/month yet.

---

## Step Function: Generate Plan

### State Machine Definition (summary)

```
Start
  → ValidateInput (Lambda)
      success → CallClaude (Lambda)
      failure → HandleError (Lambda) → End
  → CallClaude (Lambda)
      success → SavePlan (Lambda)
      failure (retries: 2) → HandleError (Lambda) → End
  → SavePlan (Lambda)
      success → NotifyUser (Lambda)
  → NotifyUser (Lambda)
      → End
```

### CallClaude Lambda — Claude Prompt

Model: `claude-opus-4-6`

System prompt:
```
You are FurCircle's dog wellness engine. You generate personalised monthly wellness plans
for dog owners based on their dog's breed, age, and health context.

Always respond with valid JSON matching the exact schema provided. No markdown, no explanation.
Only the JSON object.
```

User prompt (constructed dynamically):
```
Generate a monthly wellness plan for a dog with the following profile:
- Breed: {breed}
- Age: {ageMonths} months
- Spayed/Neutered: {spayedNeutered}
- Medical conditions: {medicalConditions}
- Environment: {environment}

Today's month: {yyyy-mm}

Return a JSON object with these exact keys:
{
  "whatToExpect": "string — 2-3 sentence narrative overview of this developmental stage",
  "whatToDo": [{ "text": "string", "videoTopic": "string — optional topic for training video" }],
  "whatNotToDo": [{ "text": "string" }],
  "watchFor": [{ "text": "string" }],
  "earlyWarningSigns": [{ "text": "string", "action": "string" }],
  "comingUpNextMonth": "string — 1-2 sentences previewing next month",
  "milestones": [
    { "emoji": "string", "title": "string", "description": "string" }
  ],
  "wellnessScore": number between 0 and 100
}

Rules:
- whatToDo: 4–6 items
- whatNotToDo: 2–4 items
- watchFor: 2–4 items
- earlyWarningSigns: 2–4 items
- milestones: exactly 3 items
- wellnessScore: baseline for a healthy dog of this breed and age (not penalised for user's specific dog)
- All advice must be appropriate for this specific breed and age in months
```

---

## Error Handling

| Scenario                           | HTTP Status | Error code                  |
|------------------------------------|-------------|-----------------------------|
| Unauthenticated request            | 401         | `UNAUTHORIZED`              |
| Dog belongs to different owner     | 403         | `FORBIDDEN`                 |
| Dog not found                      | 404         | `DOG_NOT_FOUND`             |
| Plan not yet generated             | 200         | `planStatus: generating`    |
| Validation error                   | 400         | `VALIDATION_ERROR` + field  |
| DynamoDB error                     | 500         | `INTERNAL_ERROR`            |
| Claude API error                   | Step Fn     | Retry x2, then notify user  |

All error responses:
```json
{
  "error": "DOG_NOT_FOUND",
  "message": "No dog found with id abc123"
}
```

---

## IAM Permissions (per Lambda)

| Lambda            | DynamoDB          | S3         | Cognito            | Step Functions     | SNS    |
|-------------------|-------------------|------------|--------------------|-------------------|--------|
| postConfirmation  | PutItem           | —          | AdminAddUserToGroup| —                 | —      |
| getMe             | GetItem           | —          | —                  | —                 | —      |
| updateMe          | UpdateItem        | —          | —                  | —                 | —      |
| createDog         | PutItem, BatchWrite| —         | —                  | StartExecution    | —      |
| listDogs          | Query (GSI1)      | —          | —                  | —                 | —      |
| getDog            | GetItem, Query    | —          | —                  | —                 | —      |
| updateDog         | UpdateItem        | —          | —                  | —                 | —      |
| getDogPhotoUrl    | GetItem           | PutObject  | —                  | —                 | —      |
| getCurrentPlan    | GetItem, Query    | —          | —                  | —                 | —      |
| validateInput     | GetItem           | —          | —                  | —                 | —      |
| callClaude        | —                 | —          | —                  | —                 | —      |
| savePlan          | PutItem, UpdateItem| —         | —                  | —                 | —      |
| notifyPlanReady   | GetItem           | —          | —                  | —                 | Publish|

---

## File Structure

```
furbeta/
  docs/
    dynamodb-table-design.md       ← global table design (all phases)
    spec-phase1-auth-onboarding.md ← this file
  src/
    functions/
      auth/
        postConfirmation.js
      owners/
        getMe.js
        updateMe.js
      dogs/
        createDog.js
        listDogs.js
        getDog.js
        updateDog.js
        getDogPhotoUrl.js
        getCurrentPlan.js
      plan/
        validateInput.js
        callClaude.js
        savePlan.js
        notifyPlanReady.js
    lib/
      dynamodb.js      ← DynamoDB DocumentClient singleton
      s3.js            ← S3 client + presigned URL helper
      claude.js        ← Anthropic SDK wrapper
      response.js      ← Standard API response helpers (success, error)
      auth.js          ← Extract userId from Cognito JWT context
  stepfunctions/
    generatePlan.asl.json
  serverless.yml
  package.json
```

---

## Open Questions (resolve before building)

- [ ] Breed list — static JSON file in Lambda, or DynamoDB lookup table?
- [ ] Push notification provider — Expo Push Notifications or Firebase FCM?
- [ ] Should `GET /dogs/{dogId}/plan` return the current month only, or accept a `?month=2026-03` query param for history? (Recommend: support query param, default to current month)
- [ ] Monthly plan refresh — EventBridge rule on the 1st of each month to trigger Step Function for all dogs, or triggered by first app open of the month? (Recommend: EventBridge scheduled rule)
