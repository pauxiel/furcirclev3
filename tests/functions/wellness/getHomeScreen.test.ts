/**
 * Unit tests for GET /home
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/wellness/getHomeScreen';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId?: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    queryStringParameters: dogId ? { dogId } : undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const ownerProfile = {
  PK: 'OWNER#owner-123',
  SK: 'PROFILE',
  userId: 'owner-123',
  firstName: 'Paul',
  email: 'paul@example.com',
};

const ownerSubscription = {
  PK: 'OWNER#owner-123',
  SK: 'SUBSCRIPTION',
  plan: 'welcome',
};

const dogRecord = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  name: 'Buddy',
  ownerId: 'owner-123',
  planStatus: 'ready',
  wellnessScore: 72,
  categoryScores: { trainingBehaviour: 70, feedingNutrition: 70, health: 70, socialisation: 70 },
  GSI1PK: 'OWNER#owner-123',
  GSI1SK: 'DOG#dog-123',
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
    activityId: 'act-1',
    type: 'completed_task',
    taskText: 'Teach sit, come, down and stay',
    category: 'trainingBehaviour',
    createdAt: '2026-04-15T10:00:00Z',
  },
];

/** Mock sequence:
 * Batch 1 (parallel):
 *   call[0] = BatchGetItem (owner profile + subscription)
 *   call[1] = Query GSI1 (dogs)
 * Batch 2 (parallel, only if dog found):
 *   call[2] = GetItem plan
 *   call[3] = Query activities
 */
describe('getHomeScreen handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with all home screen fields', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({                             // BatchGetItem
        Responses: {
          'furcircle-test': [ownerProfile, ownerSubscription],
        },
      })
      .mockResolvedValueOnce({ Items: [dogRecord] })       // Query GSI1 dogs
      .mockResolvedValueOnce({ Item: planRecord })         // GetItem plan
      .mockResolvedValueOnce({ Items: activityItems });    // Query activities

    const res = await handler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.owner).toBeDefined();
    expect(body.dog).toBeDefined();
    expect(body.plan).toBeDefined();
    expect(body.actionSteps).toBeDefined();
    expect(body.ctaBanners).toBeDefined();
  });

  it('marks completed action steps', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [dogRecord] })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: activityItems });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    const steps = body.actionSteps as Array<{ text: string; completed: boolean }>;
    expect(steps.find((s) => s.text === 'Teach sit, come, down and stay')?.completed).toBe(true);
    expect(steps.find((s) => s.text === 'Feed twice daily with puppy food')?.completed).toBe(false);
  });

  it('shows upgrade ctaBanner for welcome plan', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [dogRecord] })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    const banners = body.ctaBanners as Array<{ type: string }>;
    expect(banners.some((b) => b.type === 'upgrade')).toBe(true);
  });

  it('no upgrade banner for premium plan', async () => {
    const premiumSub = { ...ownerSubscription, plan: 'premium' };
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, premiumSub] } })
      .mockResolvedValueOnce({ Items: [dogRecord] })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    const banners = body.ctaBanners as Array<{ type: string }>;
    expect(banners.some((b) => b.type === 'upgrade')).toBe(false);
  });

  it('resolves correct dog when ?dogId provided', async () => {
    const dog2 = { ...dogRecord, dogId: 'dog-456', name: 'Luna', GSI1SK: 'DOG#dog-456', PK: 'DOG#dog-456' };
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [dogRecord, dog2] })
      .mockResolvedValueOnce({ Item: { ...planRecord, PK: 'DOG#dog-456' } })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-456'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dog.dogId).toBe('dog-456');
  });

  it('returns dog:null plan:null when owner has no dogs', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [] });  // no dogs

    const res = await handler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dog).toBeNull();
    expect(body.plan).toBeNull();
  });

  it('returns plan:{ planStatus: generating } when plan still generating', async () => {
    const generatingDog = { ...dogRecord, planStatus: 'generating' };
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [generatingDog] })
      .mockResolvedValueOnce({ Item: undefined })  // no plan yet
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.plan).toEqual({ planStatus: 'generating' });
    expect(body.actionSteps).toEqual([]);
  });

  it('returns plan:null when no plan exists and dog is ready (new dog)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [dogRecord] })
      .mockResolvedValueOnce({ Item: undefined })  // no plan
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.plan).toBeNull();
    expect(body.actionSteps).toEqual([]);
  });

  it('includes pillSummaries in response', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, ownerSubscription] } })
      .mockResolvedValueOnce({ Items: [dogRecord] })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: activityItems });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.pillSummaries).toBeDefined();
    expect(body.pillSummaries.whatToDo).toMatch(/\d+ action/);
  });
});
