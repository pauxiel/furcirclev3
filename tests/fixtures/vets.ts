/**
 * Veterinarian test fixture.
 *
 * Vets are NOT self-signup: an admin creates the Cognito user, sets a password,
 * adds them to the `vets` group, and writes their VET# profile (+ GSI3 keys so
 * they appear in the provider listing / broadcast fan-out). This fixture mirrors
 * that real onboarding so e2e tests exercise the true vet auth path — using
 * AdminCreateUser (not SignUp) deliberately avoids firing the postConfirmation
 * trigger, which would otherwise make the user an owner.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const region = process.env['AWS_REGION'] ?? 'us-east-1';
const cognito = new CognitoIdentityProviderClient({ region });
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export interface TestVet {
  username: string;
  email: string;
  password: string;
  vetId: string; // Cognito sub
  idToken: string;
  accessToken: string;
}

/** Decodes the `sub` claim from a Cognito JWT without verifying the signature. */
const subFromIdToken = (idToken: string): string => {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
  return payload.sub as string;
};

/**
 * Creates an admin-provisioned veterinarian: Cognito user in the `vets` group
 * plus a VET# profile with GSI3 keys. Returns the vet with login tokens.
 */
export const given_a_veterinarian = async (
  overrides: { firstName?: string; lastName?: string } = {},
): Promise<TestVet> => {
  const userPoolId = process.env['USER_POOL_ID'];
  const clientId = process.env['USER_POOL_CLIENT_ID'];
  const table = process.env['TABLE_NAME'];
  if (!userPoolId || !clientId || !table) {
    throw new Error('USER_POOL_ID, USER_POOL_CLIENT_ID and TABLE_NAME must be set for integration tests');
  }

  const email = `vet-${randomUUID()}@furcircle-test.com`;
  const password = 'Test1234!';
  const firstName = overrides.firstName ?? 'Vet';
  const lastName = overrides.lastName ?? 'Tester';

  // Admin creates the user (no email sent, no signup trigger).
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: email,
    MessageAction: 'SUPPRESS',
    TemporaryPassword: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'given_name', Value: firstName },
      { Name: 'family_name', Value: lastName },
    ],
  }));

  // Make the password permanent so USER_PASSWORD_AUTH works.
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: email,
    Password: password,
    Permanent: true,
  }));

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: email,
    GroupName: 'vets',
  }));

  const authResult = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }));

  const idToken = authResult.AuthenticationResult?.IdToken;
  const accessToken = authResult.AuthenticationResult?.AccessToken;
  if (!idToken || !accessToken) throw new Error(`[${email}] failed to get vet tokens`);

  const vetId = subFromIdToken(idToken);

  // VET# profile + GSI3 keys (PROVIDER_TYPE#veterinarian, rating-sorted).
  await doc.send(new PutCommand({
    TableName: table,
    Item: {
      PK: `VET#${vetId}`,
      SK: 'PROFILE',
      GSI3PK: 'PROVIDER_TYPE#veterinarian',
      GSI3SK: `RATING#0.00#VET#${vetId}`,
      vetId,
      firstName,
      lastName,
      email,
      providerType: 'veterinarian',
      specialisation: 'General practice',
      rating: 0,
      isActive: true,
      pushToken: null,
      createdAt: new Date().toISOString(),
    },
  }));

  console.log(`[fixture] created vet: ${email} (${vetId})`);
  return { username: email, email, password, vetId, idToken, accessToken };
};

/** Deletes the vet's Cognito user and VET# profile. */
export const teardown_vet = async (vet: TestVet | null): Promise<void> => {
  if (!vet?.username) return;
  const userPoolId = process.env['USER_POOL_ID'];
  const table = process.env['TABLE_NAME'];

  if (table && vet.vetId) {
    await doc.send(new DeleteCommand({ TableName: table, Key: { PK: `VET#${vet.vetId}`, SK: 'PROFILE' } }));
  }
  if (userPoolId) {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: vet.username }));
  }
  console.log(`[teardown] deleted vet: ${vet.username}`);
};
