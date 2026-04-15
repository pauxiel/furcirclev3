# FurCircle — Phase 2 Spec: Home Screen & Wellness

## Scope

Build the APIs that power the home screen and dog wellness tracking:
- Home screen data (hero card, milestones, action steps, training videos, CTAs)
- Monthly journey detail page (full 4-pillar plan)
- Wellness score by category (Training, Feeding, Health, Socialisation)
- Activity logging (owner marks tasks complete → score adjusts)
- Monthly plan auto-refresh via EventBridge (1st of each month)

Depends on: Phase 1 (dog profile + AI plan must exist).

---

## AWS Resources

### EventBridge Rule — `furcircle-monthly-plan-refresh`

| Setting        | Value                             |
|----------------|-----------------------------------|
| Schedule       | `cron(0 0 1 * ? *)` — midnight UTC on 1st of every month |
| Target         | Lambda: `triggerMonthlyRefresh`   |
| Input          | `{}` (Lambda scans all dogs)      |

### DynamoDB additions (Phase 2)

New entity: **Activity Log** — tracks what the owner has completed.

| Attribute   | Type   | Value                                          |
|-------------|--------|------------------------------------------------|
| PK          | String | `DOG#${dogId}`                                 |
| SK          | String | `ACTIVITY#${yyyy-mm}#${activityId}`           |
| GSI1PK      | String | `OWNER#${ownerId}`                             |
| GSI1SK      | String | `ACTIVITY#${yyyy-mm}#${activityId}`           |
| activityId  | String | UUID                                           |
| dogId       | String |                                                |
| ownerId     | String |                                                |
| month       | String | `2026-04`                                      |
| type        | String | `completed_task` / `skipped_task`             |
| taskText    | String | The task text from the plan                   |
| createdAt   | String | ISO 8601                                       |

**Wellness score category scores** stored on the dog profile as a map:

```json
"categoryScores": {
  "trainingBehaviour": 85,
  "feedingNutrition": 80,
  "health": 75,
  "socialisation": 90
}
```

Updated when activities are logged.

---

## Lambda Functions

| Function               | Trigger                        | Purpose                                          |
|------------------------|--------------------------------|--------------------------------------------------|
| `getHomeScreen`        | GET /home                      | Aggregated home screen data                      |
| `getMonthlyJourney`    | GET /dogs/{dogId}/journey      | Full 4-pillar plan detail page                   |
| `logActivity`          | POST /dogs/{dogId}/activities  | Mark task complete/skipped, update wellness score|
| `getActivities`        | GET /dogs/{dogId}/activities   | List activities logged for current month         |
| `triggerMonthlyRefresh`| EventBridge (1st of month)     | Fan out: start Step Function for each dog        |
| `refreshPlanForDog`    | Step Function (called per dog) | Re-generate plan for new month (reuses Phase 1 callClaude + savePlan) |

---

## API Endpoints

### GET /home

The primary data source for the mobile home screen. Returns everything in one call
to avoid multiple round trips.

**Query params:** `dogId` (optional — if owner has multiple dogs, specify which; defaults to first/only dog)

**Response 200:**
```json
{
  "owner": {
    "firstName": "Joshua",
    "subscription": {
      "plan": "welcome",
      "creditBalance": 0
    }
  },
  "dog": {
    "dogId": "uuid",
    "name": "Buddy",
    "breed": "Golden Retriever",
    "ageMonths": 3,
    "photoUrl": "https://...",
    "wellnessScore": 72,
    "categoryScores": {
      "trainingBehaviour": 85,
      "feedingNutrition": 80,
      "health": 75,
      "socialisation": 90
    }
  },
  "plan": {
    "month": "2026-04",
    "monthNumber": 3,
    "whatToExpect": "Your Golden Retriever is at peak learning capacity...",
    "pillSummaries": {
      "whatToDo": "5 actions",
      "whatNotToDo": "3 cautions",
      "watchFor": "2 things"
    },
    "milestones": [
      { "emoji": "🐾", "title": "Socialisation window closing soon", "description": "..." },
      { "emoji": "🎓", "title": "Basic commands this month", "description": "..." },
      { "emoji": "🦷", "title": "Bite inhibition training", "description": "..." }
    ],
    "actionSteps": [
      {
        "activityId": "derived-from-plan",
        "text": "Basic commands this month",
        "detail": "Your Golden Retriever is ready to learn sit, come, down and stay...",
        "completed": false,
        "videoUrl": null
      },
      {
        "activityId": "derived-from-plan",
        "text": "Bite inhibition training",
        "detail": "Mouthing at 3 months must be addressed before it becomes a real problem...",
        "completed": false,
        "videoUrl": null
      }
    ],
    "trainingVideos": [
      {
        "title": "Teaching sit, come and down using positive reinforcement",
        "subtitle": "How to use treats and timing correctly with 3-month puppies",
        "videoUrl": "https://..."
      }
    ],
    "planStatus": "ready"
  },
  "ctaBanners": [
    {
      "type": "upgrade",
      "visible": true,
      "message": "Upgrade to get credits"
    }
  ]
}
```

**Logic:**
1. Get owner profile + subscription → `PK=OWNER#${userId}, SK=PROFILE` and `SK=SUBSCRIPTION`
2. Get dog profile → GSI1 query for owner's dogs, take first (or dogId param)
3. Get current plan → `PK=DOG#${dogId}, SK=PLAN#${currentMonth}`
4. Get activities this month → `PK=DOG#${dogId}, SK begins_with ACTIVITY#${currentMonth}`
5. Mark each action step `completed: true` if a matching `completed_task` activity exists
6. Build `ctaBanners` based on subscription plan (show upgrade if `welcome` or `protector`)

---

### GET /dogs/{dogId}/journey

Full monthly journey detail page — all 4 pillars expanded.

**Query params:** `month` (optional, format `yyyy-mm`, defaults to current month)

**Response 200:**
```json
{
  "dogId": "uuid",
  "dogName": "Buddy",
  "breed": "Golden Retriever",
  "ageMonths": 3,
  "month": "2026-04",
  "monthLabel": "Month 3 with Buddy",
  "whatToExpect": "Your Golden Retriever is at peak learning capacity right now...",
  "whatToDo": [
    {
      "text": "Teach sit, come, down and stay using positive reinforcement. Five-minute sessions three times daily.",
      "videoUrl": "https://...",
      "completed": false
    }
  ],
  "whatNotToDo": [
    { "text": "Don't take to off-leash dog parks — not fully vaccinated." }
  ],
  "watchFor": [
    { "text": "Excessive hiding when meeting new people." }
  ],
  "earlyWarningSigns": [
    { "text": "Persistent limping", "action": "See a vet immediately." }
  ],
  "comingUpNextMonth": "Month 4 focuses on adolescence boundaries and recall training.",
  "trainingVideos": [
    {
      "title": "Teaching sit, come and down using positive reinforcement",
      "subtitle": "How to use treats and timing correctly",
      "videoUrl": "https://..."
    }
  ],
  "generatedAt": "2026-04-15T10:30:00Z"
}
```

---

### POST /dogs/{dogId}/activities

Log a completed or skipped task. Updates the wellness score.

**Request body:**
```json
{
  "type": "completed_task",
  "taskText": "Teach sit, come, down and stay using positive reinforcement"
}
```

**Validation:**
- `type`: required, `completed_task` or `skipped_task`
- `taskText`: required, must match a task in the current month's plan

**Lambda actions:**
1. Verify task exists in current plan (prevents arbitrary logging)
2. Write `ACTIVITY#${currentMonth}#${activityId}` to DynamoDB
3. Recalculate wellness score:
   - `completed_task` → +2 points to relevant category (capped at 100)
   - `skipped_task` → -1 point to relevant category (floor at 0)
   - Determine category from task text via keyword matching (training/feeding/health/socialisation)
4. Update `dog.categoryScores` and recompute `dog.wellnessScore` (average of 4 categories)
5. Return updated scores

**Response 201:**
```json
{
  "activityId": "uuid",
  "type": "completed_task",
  "taskText": "Teach sit, come, down and stay...",
  "wellnessScore": 74,
  "categoryScores": {
    "trainingBehaviour": 87,
    "feedingNutrition": 80,
    "health": 75,
    "socialisation": 90
  },
  "createdAt": "2026-04-15T14:00:00Z"
}
```

---

### GET /dogs/{dogId}/activities

List activities logged for a given month.

**Query params:** `month` (optional, defaults to current month)

**Response 200:**
```json
{
  "month": "2026-04",
  "activities": [
    {
      "activityId": "uuid",
      "type": "completed_task",
      "taskText": "Teach sit, come, down and stay...",
      "createdAt": "2026-04-15T14:00:00Z"
    }
  ],
  "completedCount": 1,
  "totalTasks": 5
}
```

---

## Monthly Refresh (EventBridge)

### triggerMonthlyRefresh Lambda

Fires on the 1st of each month.

**Actions:**
1. Query GSI1 for all plans from the previous month: `GSI1PK=PLAN#${prevMonth}` → get list of dogIds
2. For each dogId: start Step Function execution (reuses Phase 1 `generatePlan` state machine)
3. Each execution receives `{ dogId, triggerType: "monthly_refresh" }`
4. Log count of executions started

**Note:** Use DynamoDB pagination if dog count exceeds 1MB scan limit. Fan out with `Promise.allSettled` for batches of 25.

---

## Wellness Score Logic

### Category assignment (keyword matching)

| Keywords in task text                              | Category              |
|----------------------------------------------------|-----------------------|
| train, command, sit, come, stay, down, leash, recall | trainingBehaviour   |
| feed, food, diet, nutrition, meal, water, treat    | feedingNutrition      |
| vaccin, vet, health, medical, groom, dental, weight| health                |
| social, meet, people, dog, park, expose, experience| socialisation         |
| (no match)                                         | trainingBehaviour (default) |

### Score calculation

```
categoryScore = current + (type === 'completed_task' ? +2 : -1)
categoryScore = Math.min(100, Math.max(0, categoryScore))
wellnessScore = Math.round((trainingBehaviour + feedingNutrition + health + socialisation) / 4)
```

Initial baseline scores come from the AI plan's `wellnessScore` field, distributed evenly across categories.

---

## IAM Permissions (Phase 2 additions)

| Lambda                 | DynamoDB                        | EventBridge | Step Functions  |
|------------------------|---------------------------------|-------------|-----------------|
| getHomeScreen          | GetItem (x3), Query             | —           | —               |
| getMonthlyJourney      | GetItem, Query                  | —           | —               |
| logActivity            | PutItem, UpdateItem, GetItem    | —           | —               |
| getActivities          | Query                           | —           | —               |
| triggerMonthlyRefresh  | Query (GSI1)                    | —           | StartExecution  |

---

## Open Questions

- [ ] Training videos — are these YouTube/Vimeo links stored in the AI plan output, or a separate curated video library in DynamoDB? (Recommend: store as a separate `VIDEO` entity keyed by topic, plan references topic, Lambda resolves URL)
- [ ] Journey progress circles (months 1–12 shown on My Dog screen) — is this just `ageMonths` mod 12, or does it track completed months separately?
- [ ] Wellness score on plan refresh — reset to AI baseline each month, or carry over from previous month's activity-adjusted score?
