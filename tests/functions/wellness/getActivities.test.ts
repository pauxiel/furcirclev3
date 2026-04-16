/**
 * Unit tests for GET /dogs/{dogId}/activities
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/wellness/getActivities';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  month?: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    queryStringParameters: month ? { month } : undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
  planStatus: 'ready',
  wellnessScore: 72,
};

const planRecord = {
  PK: 'DOG#dog-123',
  SK: 'PLAN#2026-04',
  whatToDo: [
    { text: 'Teach sit, come, down and stay' },
    { text: 'Feed twice daily' },
    { text: 'Schedule vaccination' },
  ],
};

const activityItems = [
  {
    PK: 'DOG#dog-123',
    SK: 'ACTIVITY#2026-04#act-1',
    activityId: 'act-1',
    dogId: 'dog-123',
    type: 'completed_task',
    taskText: 'Teach sit, come, down and stay',
    category: 'trainingBehaviour',
    createdAt: '2026-04-15T10:00:00Z',
  },
];

describe('getActivities handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with activities and counts', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })   // GetItem dog
      .mockResolvedValueOnce({ Item: planRecord })   // GetItem plan
      .mockResolvedValueOnce({ Items: activityItems }); // Query activities

    const res = await handler(makeEvent('dog-123'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.activities).toHaveLength(1);
    expect(body.completedCount).toBe(1);
    expect(body.totalTasks).toBe(3);
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns empty activities when none logged', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.activities).toEqual([]);
    expect(body.completedCount).toBe(0);
    expect(body.totalTasks).toBe(3);
  });

  it('respects ?month query param', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: { ...planRecord, SK: 'PLAN#2026-03' } })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('dog-123', '2026-03'));

    const queryCall = mockDocClientSend.mock.calls[2][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    const values = Object.values(queryCall.input.ExpressionAttributeValues);
    expect(values.some((v) => (v as string).includes('2026-03'))).toBe(true);
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', undefined, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns totalTasks=0 when no plan exists', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: undefined }) // no plan
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.totalTasks).toBe(0);
  });
});
