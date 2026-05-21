# FurCircle — Phase 6 Spec: Admin API

## Scope

Internal admin tooling for FurCircle operators:
- Platform metrics dashboard
- User management (view + investigate owners)
- Vet management (view + deactivate)
- Booking oversight
- Manual AI plan refresh trigger

No self-service admin signup. Admins are created manually in the `admins` Cognito group. All endpoints use the same Cognito JWT authorizer as owner/vet endpoints — access is gated by group membership, not a separate auth system.

Depends on: Phase 1 (auth infrastructure), Phase 4 (bookings), Phase 5 (vets).

---

## Auth: Admin Access Control

Same Cognito User Pool. Admin access requires membership in the `admins` group.

**Check pattern (all admin Lambdas):**
```ts
if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);
```

`isAdmin()` reads `cognito:groups` claim from JWT. API Gateway serialises array claims as comma-separated strings — the helper splits on `,` before checking.

**Base path:** All admin endpoints are prefixed `/admin/`.

---

## Lambda Functions

| Function                  | Trigger                                      | Purpose                                  |
|---------------------------|----------------------------------------------|------------------------------------------|
| `adminGetMetrics`         | GET /admin/metrics                           | Platform summary: owners, subs, bookings |
| `adminListUsers`          | GET /admin/users                             | All owner profiles + subscription status |
| `adminGetUser`            | GET /admin/users/{userId}                    | Full user detail + dogs                  |
| `adminListVets`           | GET /admin/vets                              | All vet profiles + status                |
| `adminDeactivateVet`      | PUT /admin/vets/{vetId}/deactivate           | Set vet isActive=false                   |
| `adminListBookings`       | GET /admin/bookings                          | All bookings with optional status filter |
| `adminTriggerPlanRefresh` | POST /admin/dogs/{dogId}/plan-refresh        | Manually re-trigger AI plan generation   |

---

## API Endpoints

### GET /admin/metrics

Platform-level summary for the admin dashboard.

**Implementation:** Parallel Cognito `ListUsersInGroup` (owners group) + two DynamoDB Scans (paid subscriptions, today's bookings).

**Response 200:**
```json
{
  "totalOwners": 142,
  "activeSubscriptions": 89,
  "bookingsToday": 7
}
```

`activeSubscriptions`: count of SUBSCRIPTION records where `plan IN (protector, proactive)`.
`bookingsToday`: count of BOOKING records where `scheduledAt` falls within today UTC.

---

### GET /admin/users

All owner profiles with subscription data.

**Implementation:** Single Scan filtered to `OWNER#` PK prefix, SK in `(PROFILE, SUBSCRIPTION)`. Joins in-memory.

**Response 200:**
```json
{
  "users": [
    {
      "userId": "cognito-uuid",
      "firstName": "Joshua",
      "lastName": "Smith",
      "email": "joshua@example.com",
      "createdAt": "2026-01-15T10:00:00Z",
      "subscription": {
        "plan": "proactive",
        "creditBalance": 55,
        "status": "active"
      }
    }
  ]
}
```

`subscription` is `null` if no SUBSCRIPTION record exists.

---

### GET /admin/users/{userId}

Full user detail for investigation.

**Implementation:** Parallel BatchGetItem (PROFILE + SUBSCRIPTION) + GSI1 Query for dogs.

**Response 200:**
```json
{
  "userId": "cognito-uuid",
  "firstName": "Joshua",
  "lastName": "Smith",
  "email": "joshua@example.com",
  "createdAt": "2026-01-15T10:00:00Z",
  "subscription": {
    "plan": "proactive",
    "creditBalance": 55,
    "status": "active"
  },
  "dogs": [
    {
      "dogId": "dog-uuid",
      "name": "Buddy",
      "breed": "Golden Retriever",
      "planStatus": "ready"
    }
  ]
}
```

**Errors:**
- `404 NOT_FOUND` — no PROFILE record for userId

---

### GET /admin/vets

All vet profiles.

**Implementation:** Scan filtered to `VET#` PK prefix, SK = `PROFILE`.

**Response 200:**
```json
{
  "vets": [
    {
      "vetId": "cognito-uuid",
      "firstName": "Emma",
      "lastName": "Clarke",
      "email": "emma@furcircle.com",
      "providerType": "behaviourist",
      "specialisation": "Puppy behaviour & early socialisation",
      "rating": 4.9,
      "reviewCount": 71,
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### PUT /admin/vets/{vetId}/deactivate

Set a vet's `isActive` to `false`. Does not delete the Cognito user — vet can be reactivated manually.

**Lambda actions:**
1. GetItem `VET#${vetId}/PROFILE` → 404 if not found
2. UpdateItem: `isActive=false, updatedAt=now`

**Response 200:**
```json
{ "vetId": "uuid", "isActive": false }
```

**Note:** Does not cancel existing upcoming bookings. That cleanup is out of scope for Phase 6 — operator should handle manually or via a future admin action.

---

### GET /admin/bookings

All bookings across the platform.

**Query params:**
- `status` (optional): `upcoming` / `completed` / `cancelled`

**Implementation:** Scan on SK = `BOOKING` with optional status FilterExpression. Uses `ExpressionAttributeNames` for `status` (reserved word).

**Response 200:**
```json
{
  "bookings": [
    {
      "bookingId": "uuid",
      "vetId": "vet-uuid",
      "ownerId": "owner-uuid",
      "dogId": "dog-uuid",
      "status": "upcoming",
      "scheduledAt": "2026-04-18T10:00:00Z",
      "duration": 30,
      "creditsCharged": 30,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ],
  "total": 42
}
```

---

### POST /admin/dogs/{dogId}/plan-refresh

Manually trigger AI plan regeneration for a specific dog. Used when a plan is stuck in `generating` or `failed` state.

**Lambda actions:**
1. GetItem `DOG#${dogId}/PROFILE` → 404 if not found
2. Parallel:
   - UpdateItem dog: `planStatus=generating`
   - `sfn.StartExecution` with `name=admin-refresh-${dogId}-${uuid}` (unique name avoids idempotency conflicts with auto-refresh)
3. Input to state machine: `{ dogId, ownerId }` (same shape as createDog trigger)

**Response 200:**
```json
{
  "dogId": "uuid",
  "planStatus": "generating",
  "triggeredAt": "2026-04-20T14:00:00Z"
}
```

---

## IAM Permissions (Phase 6)

| Lambda                    | DynamoDB                          | Cognito                  | SSM | SNS | States             |
|---------------------------|-----------------------------------|--------------------------|-----|-----|--------------------|
| adminGetMetrics           | Scan (x2)                         | ListUsersInGroup         | —   | —   | —                  |
| adminListUsers            | Scan                              | —                        | —   | —   | —                  |
| adminGetUser              | BatchGetItem, Query (GSI1)        | —                        | —   | —   | —                  |
| adminListVets             | Scan                              | —                        | —   | —   | —                  |
| adminDeactivateVet        | GetItem, UpdateItem               | —                        | —   | —   | —                  |
| adminListBookings         | Scan                              | —                        | —   | —   | —                  |
| adminTriggerPlanRefresh   | GetItem, UpdateItem               | —                        | —   | —   | StartExecution     |

---

## Design Decisions

- **Scan over Query for listing** — admin endpoints accept higher latency in exchange for implementation simplicity. Admin usage is low-frequency; optimising with GSIs is not worth the added complexity at this scale.
- **`admins` group in same Cognito User Pool** — avoids a second User Pool. `isAdmin()` checks the JWT claim directly. No separate authorizer Lambda needed.
- **Deactivate not delete** — vet deactivation sets `isActive=false` rather than deleting the record. Preserves audit trail and referential integrity for past bookings/assessments.
- **Plan refresh uses unique execution name** — prefix `admin-refresh-` prevents collision with the monthly auto-refresh execution names (`monthly-refresh-`).
