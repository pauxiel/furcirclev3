/**
 * Unit tests for GET /dogs/{dogId}/journey
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/wellness/getMonthlyJourney';
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
  name: 'Buddy',
  ownerId: 'owner-123',
  planStatus: 'ready',
  wellnessScore: 72,
  categoryScores: { trainingBehaviour: 70, feedingNutrition: 70, health: 70, socialisation: 70 },
};

const planRecord = {
  PK: 'DOG#dog-123',
  SK: 'PLAN#2026-04',
  month: '2026-04',
  ageMonthsAtPlan: 6,
  whatToDo: [
    { text: 'Teach sit, come, down and stay', videoTopic: 'puppy basics' },
    { text: 'Feed twice daily with puppy food', videoTopic: null },
    { text: 'Schedule vaccination booster', videoTopic: null },
  ],
  whatNotToDo: ['Avoid punishment-based training'],
  watchFor: ['Excessive scratching'],
  earlyWarningSigns: ['Loss of appetite for more than 24h'],
};

const activityItems = [
  {
    PK: 'DOG#dog-123',
    SK: 'ACTIVITY#2026-04#act-1',
    activityId: 'act-1',
    type: 'completed_task',
    taskText: 'Teach sit, come, down and stay',
    category: 'trainingBehaviour',
    createdAt: '2026-04-15T10:00:00Z',
  },
  {
    PK: 'DOG#dog-123',
    SK: 'ACTIVITY#2026-04#act-2',
    activityId: 'act-2',
    type: 'skipped_task',
    taskText: 'Feed twice daily with puppy food',
    category: 'feedingNutrition',
    createdAt: '2026-04-15T11:00:00Z',
  },
];

describe('getMonthlyJourney handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with enriched whatToDo', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })       // GetItem dog
      .mockResolvedValueOnce({ Item: planRecord })       // GetItem plan
      .mockResolvedValueOnce({ Items: activityItems });  // Query activities

    const res = await handler(makeEvent('dog-123', '2026-04'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.whatToDo).toHaveLength(3);
    expect(body.whatToDo[0].completed).toBe(true);   // completed_task logged
    expect(body.whatToDo[1].completed).toBe(false);  // only skipped, not completed
    expect(body.whatToDo[2].completed).toBe(false);  // no activity
  });

  it('returns monthLabel with dog name and ageMonthsAtPlan', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', '2026-04'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.monthLabel).toBe('Month 6 with Buddy');
  });

  it('returns all 4 plan pillars', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', '2026-04'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.whatToDo).toBeDefined();
    expect(body.whatNotToDo).toBeDefined();
    expect(body.watchFor).toBeDefined();
    expect(body.earlyWarningSigns).toBeDefined();
  });

  it('uses current month when no ?month param', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('dog-123'));

    const planGetCall = mockDocClientSend.mock.calls[1][0] as {
      input: { Key: { SK: string } };
    };
    expect(planGetCall.input.Key.SK).toMatch(/^PLAN#\d{4}-\d{2}$/);
  });

  it('returns { planStatus: generating } when no plan and dog is generating', async () => {
    const generatingDog = { ...dogProfile, planStatus: 'generating' };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: generatingDog })
      .mockResolvedValueOnce({ Item: undefined }); // no plan

    const res = await handler(makeEvent('dog-123', '2026-04'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.planStatus).toBe('generating');
  });

  it('returns 404 when no plan and dog is ready', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: undefined }); // no plan

    const res = await handler(makeEvent('dog-123', '2025-01'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', '2026-04', 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 when dogId missing', async () => {
    const event = makeEvent('dog-123', '2026-04');
    (event as unknown as { pathParameters: null }).pathParameters = null;

    const res = await handler(event);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('includes wellness metadata in response', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: activityItems });

    const res = await handler(makeEvent('dog-123', '2026-04'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.wellnessScore).toBe(dogProfile.wellnessScore);
    expect(body.categoryScores).toEqual(dogProfile.categoryScores);
    expect(body.completedCount).toBe(1);
    expect(body.totalTasks).toBe(3);
  });
});
