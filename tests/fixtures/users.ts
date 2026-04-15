import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const cognito = new CognitoIdentityProviderClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

export interface TestUser {
  username: string;
  email: string;
  password: string;
  idToken: string;
  accessToken: string;
}

/**
 * Creates a real Cognito user, confirms them via admin (no email OTP needed),
 * and returns their tokens. Use in beforeAll/beforeEach.
 */
export const given_an_authenticated_user = async (): Promise<TestUser> => {
  const userPoolId = process.env['USER_POOL_ID'];
  const clientId = process.env['USER_POOL_CLIENT_ID'];

  if (!userPoolId || !clientId) {
    throw new Error('USER_POOL_ID and USER_POOL_CLIENT_ID must be set in env for integration tests');
  }

  const email = `test-${randomUUID()}@furcircle-test.com`;
  const password = 'Test1234!';

  // Sign up
  await cognito.send(new SignUpCommand({
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'given_name', Value: 'Test' },
      { Name: 'family_name', Value: 'User' },
    ],
  }));

  // Confirm without requiring OTP — admin bypass
  await cognito.send(new AdminConfirmSignUpCommand({
    UserPoolId: userPoolId,
    Username: email,
  }));

  // Get tokens
  const authResult = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  }));

  const idToken = authResult.AuthenticationResult?.IdToken;
  const accessToken = authResult.AuthenticationResult?.AccessToken;

  if (!idToken || !accessToken) {
    throw new Error(`[${email}] - failed to get tokens after sign-up`);
  }

  console.log(`[fixture] created user: ${email}`);

  return { username: email, email, password, idToken, accessToken };
};

/**
 * Deletes a test user from Cognito. Call in afterAll/afterEach.
 */
export const teardown_user = async (user: TestUser | null): Promise<void> => {
  if (!user?.username) {
    console.log('[teardown] no user to delete');
    return;
  }

  const userPoolId = process.env['USER_POOL_ID'];
  if (!userPoolId) return;

  await cognito.send(new AdminDeleteUserCommand({
    UserPoolId: userPoolId,
    Username: user.username,
  }));

  console.log(`[teardown] deleted user: ${user.username}`);
};
