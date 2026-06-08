/**
 * Unit tests for POST /threads (createThread) — Ask-a-Vet broadcast model.
 * A question is created unassigned and fanned out to all vets; the first vet
 * to reply claims it (see vetSendMessage).
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

const validBody = {
  dogId: 'dog-123',
  type: 'ask_a_vet',
  initialMessage: 'Is mouthing normal at 3 months?',
};

describe('createThread handler (broadcast)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:furcircle-notifications-test';
  });

  it('returns 201 with an unassigned thread and the first message', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })        // GetItem dog
      .mockResolvedValueOnce({ Item: ownerSubscription }) // GetItem subscription
      .mockResolvedValueOnce({ Count: 0 })                // Query GSI1 (welcome gate)
      .mockResolvedValueOnce({})                          // PutItem THREAD METADATA
      .mockResolvedValueOnce({});                         // PutItem first MSG
    mockSnsSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threadId).toBe('test-thread-uuid');
    expect(body.status).toBe('unassigned');
    expect(body.vetId).toBeNull();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].senderType).toBe('owner');
  });

  it('returns 404 DOG_NOT_FOUND when dog missing', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: ownerSubscription });

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('DOG_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when dog belongs to different owner', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other-owner' } })
      .mockResolvedValueOnce({ Item: ownerSubscription });

    const res = await handler(makeEvent(validBody));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('returns 403 MONTHLY_LIMIT_REACHED for welcome plan with existing thread this month', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
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

  it('METADATA item is unassigned and placed in the shared broadcast queue', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
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
    expect(item['GSI2PK']).toBe('QUEUE#ask_a_vet');
    expect((item['GSI2SK'] as string)).toMatch(/^THREAD#unassigned#/);
    expect(item['vetId']).toBeNull();
    expect(item['status']).toBe('unassigned');
  });

  it('publishes a question_broadcast notification', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent(validBody));

    const publish = (mockSnsSend.mock.calls[0][0] as { input: { Subject: string; Message: string } }).input;
    expect(publish.Subject).toBe('question_broadcast');
    const msg = JSON.parse(publish.Message);
    expect(msg.threadId).toBe('test-thread-uuid');
    expect(msg.dogName).toBe('Buddy');
  });

  it('MSG item has senderType=owner and readAt=null', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerSubscription })
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
