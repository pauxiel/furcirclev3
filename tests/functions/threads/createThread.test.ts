/**
 * Unit tests for POST /threads (createThread)
 */

const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.mock('uuid', () => ({ v4: () => 'test-thread-uuid' }));

import { handler } from '../../../src/functions/threads/createThread';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  name: 'Buddy',
  ownerId: 'owner-123',
};

const ownerSubscription = {
  PK: 'OWNER#owner-123',
  SK: 'SUBSCRIPTION',
  plan: 'welcome',
};

const vetProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Sarah',
  lastName: 'Mitchell',
  isActive: true,
  pushToken: 'ExponentPushToken[vet123]',
};

const validBody = {
  vetId: 'vet-123',
  dogId: 'dog-123',
  type: 'ask_a_vet',
  initialMessage: 'Is mouthing normal at 3 months?',
};

describe('createThread handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:furcircle-notifications-test';
  });

  it('returns 201 with threadId and first message', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })        // GetItem dog
      .mockResolvedValueOnce({ Item: ownerSubscription }) // GetItem subscription
      .mockResolvedValueOnce({ Item: vetProfile })        // GetItem vet
      .mockResolvedValueOnce({ Count: 0 })               // Query GSI1 (welcome gate)
      .mockResolvedValueOnce({})                          // PutItem THREAD METADATA
      .mockResolvedValueOnce({});                         // PutItem first MSG
    mockSnsSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threadId).toBe('test-thread-uuid');
    expect(body.status).toBe('open');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].senderType).toBe('owner');
  });

  it('returns 404 VET_NOT_FOUND when vet not in DynamoDB', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: undefined }); // vet not found

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('VET_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when dog belongs to different owner', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other-owner' } })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: vetProfile });

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('returns 403 MONTHLY_LIMIT_REACHED for welcome plan with existing thread this month', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Count: 1 }); // already has a thread this month

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('MONTHLY_LIMIT_REACHED');
  });

  it('passes gate for protector plan regardless of thread count', async () => {
    const protectorSub = { ...ownerSubscription, plan: 'protector' };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: protectorSub })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({})  // PutItem METADATA
      .mockResolvedValueOnce({}); // PutItem MSG
    mockSnsSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });

  it('returns 201 even when SNS publish throws', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockSnsSend.mockRejectedValueOnce(new Error('SNS error'));

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });

  it('returns 400 when initialMessage exceeds 2000 chars', async () => {
    const res = await handler(makeEvent({ ...validBody, initialMessage: 'x'.repeat(2001) }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('METADATA item has correct GSI1PK, GSI1SK, GSI2PK, GSI2SK keys', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent(validBody));

    const metadataCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const item = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item;
      return item?.SK === 'METADATA';
    });
    expect(metadataCall).toBeDefined();
    const item = (metadataCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['GSI1PK']).toBe('OWNER#owner-123');
    expect((item['GSI1SK'] as string)).toMatch(/^THREAD#ask_a_vet#/);
    expect(item['GSI2PK']).toBe('VET#vet-123');
    expect((item['GSI2SK'] as string)).toMatch(/^THREAD#open#/);
  });

  it('MSG item has senderType=owner and readAt=null', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent(validBody));

    const msgCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('MSG#');
    });
    expect(msgCall).toBeDefined();
    const item = (msgCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['senderType']).toBe('owner');
    expect(item['readAt']).toBeNull();
  });
});
