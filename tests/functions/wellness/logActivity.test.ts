/**
 * Unit tests for POST /dogs/{dogId}/activities
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('uuid', () => ({ v4: () => 'test-activity-uuid' }));

import { handler } from '../../../src/functions/wellness/logActivity';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    body: JSON.stringify(body),
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
  categoryScores: {
    trainingBehaviour: 70,
    feedingNutrition: 70,
    health: 70,
    socialisation: 70,
  },
};

const planRecord = {
  PK: 'DOG#dog-123',
  SK: 'PLAN#2026-04',
  whatToDo: [
    { text: 'Teach sit, come, down and stay using positive reinforcement' },
    { text: 'Feed twice daily with puppy food' },
  ],
};

describe('logActivity handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 201 with activityId and updated scores for completed_task', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })   // GetItem dog
      .mockResolvedValueOnce({ Item: planRecord })   // GetItem plan
      .mockResolvedValueOnce({})                     // PutItem activity
      .mockResolvedValueOnce({});                    // UpdateItem dog

    const res = await handler(makeEvent('dog-123', {
      type: 'completed_task',
      taskText: 'Teach sit, come, down and stay using positive reinforcement',
    }));

    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.activityId).toBe('test-activity-uuid');
    expect(body.category).toBe('trainingBehaviour');
    expect(body.wellnessScore).toBeDefined();
  });

  it('writes ACTIVITY record with correct keys', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent('dog-123', {
      type: 'completed_task',
      taskText: 'Teach sit, come, down and stay using positive reinforcement',
    }));

    const putCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('ACTIVITY#');
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['PK']).toBe('DOG#dog-123');
    expect(item['dogId']).toBe('dog-123');
    expect(item['type']).toBe('completed_task');
    expect(item['category']).toBe('trainingBehaviour');
  });

  it('increases trainingBehaviour score by 2 for a training task', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent('dog-123', {
      type: 'completed_task',
      taskText: 'Teach sit, come, down and stay using positive reinforcement',
    }));

    const updateCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const input = (c[0] as { input?: { UpdateExpression?: string } }).input;
      return input?.UpdateExpression !== undefined;
    });
    const values = (updateCall![0] as { input: { ExpressionAttributeValues: Record<string, unknown> } })
      .input.ExpressionAttributeValues;
    // trainingBehaviour was 70, +2 = 72
    expect(Object.values(values)).toContain(72);
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', { type: 'completed_task', taskText: 'anything' }, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing', { type: 'completed_task', taskText: 'anything' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 TASK_NOT_FOUND when taskText not in plan', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord });

    const res = await handler(makeEvent('dog-123', {
      type: 'completed_task',
      taskText: 'This task does not exist in the plan',
    }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(JSON.parse((res as { body: string }).body).error).toBe('TASK_NOT_FOUND');
  });

  it('returns 400 when type is missing', async () => {
    const res = await handler(makeEvent('dog-123', { taskText: 'something' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when taskText is missing', async () => {
    const res = await handler(makeEvent('dog-123', { type: 'completed_task' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('handles missing categoryScores on dog (initialises from wellnessScore)', async () => {
    const dogNoCategoryScores = { ...dogProfile, categoryScores: undefined, wellnessScore: 72 };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogNoCategoryScores })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent('dog-123', {
      type: 'completed_task',
      taskText: 'Teach sit, come, down and stay using positive reinforcement',
    }));
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });

  it('score does not exceed 100', async () => {
    const maxDog = {
      ...dogProfile,
      categoryScores: { trainingBehaviour: 99, feedingNutrition: 100, health: 100, socialisation: 100 },
      wellnessScore: 100,
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: maxDog })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const body = JSON.parse(
      ((await handler(makeEvent('dog-123', {
        type: 'completed_task',
        taskText: 'Teach sit, come, down and stay using positive reinforcement',
      }))) as { body: string }).body,
    );
    expect(body.categoryScores.trainingBehaviour).toBeLessThanOrEqual(100);
    expect(body.wellnessScore).toBeLessThanOrEqual(100);
  });
});
