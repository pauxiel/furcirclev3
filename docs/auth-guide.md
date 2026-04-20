# Authentication Guide — React Native

Auth is handled directly by **AWS Cognito**, not through the FurCircle API. There are no `/auth/login` or `/auth/signup` REST endpoints — use the Cognito SDK.

## Credentials

| Key | Value |
|-----|-------|
| Region | `us-east-1` |
| User Pool ID | `us-east-1_SkVrkM3U0` |
| App Client ID | `5uka63bgr9qs1j8jdhi2sen2g3` |

---

## Setup

```bash
npm install amazon-cognito-identity-js
```

```typescript
// src/lib/cognito.ts
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

export const userPool = new CognitoUserPool({
  UserPoolId: 'us-east-1_SkVrkM3U0',
  ClientId: '5uka63bgr9qs1j8jdhi2sen2g3',
});
```

---

## Sign Up

```typescript
import { CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { userPool } from './cognito';

export function signUp(email: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const attrs = [
      new CognitoUserAttribute({ Name: 'email', Value: email }),
    ];

    userPool.signUp(email, password, attrs, [], (err, result) => {
      if (err) return reject(err);
      resolve(result!.userSub); // Cognito sub (userId)
    });
  });
}
```

**After sign-up:** Cognito sends a 6-digit OTP to the email. Must confirm before signing in.

---

## Confirm Email (OTP)

```typescript
import { CognitoUser } from 'amazon-cognito-identity-js';
import { userPool } from './cognito';

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
```

**On confirmation:** The `postConfirmation` Lambda fires automatically — it creates the owner profile and subscription record in DynamoDB. No extra API call needed.

---

## Sign In

```typescript
import { CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { userPool } from './cognito';

export function signIn(email: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve(session.getIdToken().getJwtToken()); // idToken for API calls
      },
      onFailure: reject,
    });
  });
}
```

---

## Using the Token in API Calls

Every FurCircle API call needs the **idToken** as a Bearer token:

```typescript
const idToken = await signIn(email, password);

const response = await fetch('https://057mg3hls1.execute-api.us-east-1.amazonaws.com/dogs', {
  headers: {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  },
});
```

> **idToken expires after 1 hour.** Use the refresh token to get a new one (see below).

---

## Refresh Token (silent re-auth)

```typescript
import { userPool } from './cognito';

export function refreshIdToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser();
    if (!user) return reject(new Error('No user session'));

    user.getSession((err: Error | null, session: any) => {
      if (err) return reject(err);
      if (!session.isValid()) return reject(new Error('Session expired'));
      resolve(session.getIdToken().getJwtToken());
    });
  });
}
```

Recommended pattern: wrap all API calls to catch `401`, then refresh token and retry once.

---

## Forgot Password

```typescript
import { CognitoUser } from 'amazon-cognito-identity-js';
import { userPool } from './cognito';

// Step 1: request reset code
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.forgotPassword({ onSuccess: () => resolve(), onFailure: reject });
  });
}

// Step 2: submit new password + code from email
export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}
```

---

## Sign Out

```typescript
import { userPool } from './cognito';

export function signOut(): void {
  const user = userPool.getCurrentUser();
  user?.signOut();
}
```

---

## Auth Flow Summary

```
signUp(email, password)
  → Cognito sends OTP email
confirmSignUp(email, otp)
  → postConfirmation Lambda fires → DynamoDB OWNER + SUBSCRIPTION created
signIn(email, password)
  → returns idToken (valid 1h)
  → use as: Authorization: Bearer {idToken}
refreshIdToken()
  → silent refresh using refreshToken (valid 30 days)
```

---

## Vet Accounts

Vet accounts are created manually (admin creates user in Cognito, adds to `vets` group). Vets use the same sign-in flow — same SDK, same token format. The `cognito:groups` claim in the JWT determines access (`owners` vs `vets` vs `admins`).

---

## Error Codes

| Cognito error | Meaning |
|---------------|---------|
| `UsernameExistsException` | Email already registered |
| `CodeMismatchException` | Wrong OTP |
| `ExpiredCodeException` | OTP expired (resend via `resendConfirmationCode`) |
| `NotAuthorizedException` | Wrong password |
| `UserNotConfirmedException` | Email not confirmed yet |
| `UserNotFoundException` | No account with that email |
