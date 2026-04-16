/**
 * Unit tests for postConfirmation Lambda.
 * Mocks DynamoDB and Cognito — no AWS calls made.
 */

const mockDocClientSend = jest.fn().mockResolvedValue({});
const mockCognitoClientSend = jest.fn().mockResolvedValue({});

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args: unknown[]) => mockCognitoClientSend(...args) })),
  AdminAddUserToGroupCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { handler } from '../../../src/functions/auth/postConfirmation';
import type { PostConfirmationTriggerEvent, Context } from 'aws-lambda';

const makeEvent = (overrides: Partial<PostConfirmationTriggerEvent['request']['userAttributes']> = {}): PostConfirmationTriggerEvent => ({
  version: '1',
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool',
  userName: 'user-sub-123',
  callerContext: { awsSdkVersion: '3', clientId: 'test-client-id' },
  request: {
    userAttributes: {
      sub: 'user-sub-123',
      email: 'joshua@example.com',
      given_name: 'Joshua',
      family_name: 'Smith',
      email_verified: 'true',
      ...overrides,
    },
  },
  response: {},
});

describe('postConfirmation handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['AWS_REGION'] = 'us-east-1';
  });

  it('writes OWNER PROFILE record to DynamoDB', async () => {
    await handler(makeEvent(), {} as Context, jest.fn());

    const calls = mockDocClientSend.mock.calls;
    const profileCall = calls.find((c: unknown[]) => (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK === 'PROFILE');
    expect(profileCall).toBeDefined();

    const item = (profileCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['PK']).toBe('OWNER#user-sub-123');
    expect(item['SK']).toBe('PROFILE');
    expect(item['userId']).toBe('user-sub-123');
    expect(item['email']).toBe('joshua@example.com');
    expect(item['firstName']).toBe('Joshua');
    expect(item['lastName']).toBe('Smith');
    expect(item['GSI1PK']).toBe('EMAIL#joshua@example.com');
    expect(item['GSI1SK']).toBe('OWNER');
    expect(item['referralCode']).toMatch(/^[A-Z0-9]{6}$/);
    expect(item['createdAt']).toBeDefined();
  });

  it('writes SUBSCRIPTION record with welcome plan', async () => {
    await handler(makeEvent(), {} as Context, jest.fn());

    const calls = mockDocClientSend.mock.calls;
    const subCall = calls.find((c: unknown[]) => (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK === 'SUBSCRIPTION');
    expect(subCall).toBeDefined();

    const item = (subCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['PK']).toBe('OWNER#user-sub-123');
    expect(item['SK']).toBe('SUBSCRIPTION');
    expect(item['plan']).toBe('welcome');
    expect(item['creditBalance']).toBe(0);
    expect(item['status']).toBe('active');
  });

  it('adds user to owners Cognito group', async () => {
    await handler(makeEvent(), {} as Context, jest.fn());

    expect(mockCognitoClientSend).toHaveBeenCalledTimes(1);
    const cmd = mockCognitoClientSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input['UserPoolId']).toBe('us-east-1_TestPool');
    expect(cmd.input['Username']).toBe('user-sub-123');
    expect(cmd.input['GroupName']).toBe('owners');
  });

  it('returns the event unchanged (Cognito requirement)', async () => {
    const event = makeEvent();
    const result = await handler(event, {} as Context, jest.fn());
    expect(result).toEqual(event);
  });

  it('both PutItem calls run in parallel (docClient called twice)', async () => {
    await handler(makeEvent(), {} as Context, jest.fn());
    // PROFILE + SUBSCRIPTION writes
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
  });

  it('generates unique 6-char alphanumeric referral codes', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      jest.clearAllMocks();
      await handler(makeEvent(), {} as Context, jest.fn());
      const profileCall = mockDocClientSend.mock.calls.find(
        (c: unknown[]) => (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK === 'PROFILE',
      );
      const code = (profileCall![0] as { input: { Item: { referralCode: string } } }).input.Item.referralCode;
      codes.add(code);
    }
    // Should generate different codes across runs (not all the same)
    expect(codes.size).toBeGreaterThan(1);
  });
});
