/**
 * Unit tests for GET /dogs/{dogId}/plan/steps/{stepId}
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/wellness/getPlanStep';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  stepId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId, stepId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
};

const step = {
  stepId: 'basic-commands',
  title: 'Basic Commands',
  text: 'Teach sit and stay using positive reinforcement.',
  steps: [
    { frequency: 'Three times daily', title: 'Teach sit using treat lure', text: 'Hold treat above nose.' },
    { frequency: 'Daily', title: 'Reinforce name recognition', text: 'Say name once, reward eye contact.' },
  ],
};

const planRecord = {
  PK: 'DOG#dog-123',
  SK: 'PLAN#2026-05',
  month: '2026-05',
  whatToDo: [
    step,
    { stepId: 'socialisation-walks', title: 'Socialisation Walks', text: 'Expose to varied environments.', steps: [] },
  ],
};

describe('getPlanStep handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with step detail and steps array', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })           // GetItem dog
      .mockResolvedValueOnce({ Item: planRecord })           // GetItem plan
      .mockResolvedValueOnce({ Items: [] });                 // Query activities

    const res = await handler(makeEvent('dog-123', 'basic-commands'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.stepId).toBe('basic-commands');
    expect(body.title).toBe('Basic Commands');
    expect(body.completed).toBe(false);
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps).toHaveLength(2);
  });

  it('returns completed: true when step task is logged as completed_task', async () => {
    const activities = [
      { type: 'completed_task', taskText: 'Teach sit and stay using positive reinforcement.' },
    ];
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: activities });

    const res = await handler(makeEvent('dog-123', 'basic-commands'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.completed).toBe(true);
  });

  it('returns 404 STEP_NOT_FOUND when stepId not in plan', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: planRecord })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', 'nonexistent-step'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('STEP_NOT_FOUND');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other-owner' } });

    const res = await handler(makeEvent('dog-123', 'basic-commands', 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('FORBIDDEN');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing-dog', 'basic-commands'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('DOG_NOT_FOUND');
  });

  // Regression: old plan data has no stepId stored — frontend receives step-0, step-1 etc from /home
  it('resolves step-0 for old plan data without stored stepId (videoTopic fallback)', async () => {
    const oldFormatPlan = {
      PK: 'DOG#dog-123',
      SK: 'PLAN#2026-05',
      month: '2026-05',
      whatToDo: [
        { text: 'Provide ultra-soft orthopedic bedding throughout the home.', videoTopic: 'Setting up comfort stations for senior dogs' },
        { text: 'Schedule veterinary check-ups every 3 months.', videoTopic: null },
      ],
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: oldFormatPlan })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', 'setting-up-comfort-stations-for-senior-dogs'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.stepId).toBe('setting-up-comfort-stations-for-senior-dogs');
  });

  it('resolves step-1 for old plan item where videoTopic is null', async () => {
    const oldFormatPlan = {
      PK: 'DOG#dog-123',
      SK: 'PLAN#2026-05',
      month: '2026-05',
      whatToDo: [
        { text: 'First task.', videoTopic: 'some topic' },
        { text: 'Second task with no video.', videoTopic: null },
      ],
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: oldFormatPlan })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', 'step-1'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.stepId).toBe('step-1');
    expect(body.text).toBe('Second task with no video.');
  });

  it('derives title from videoTopic when title not stored (old plan data)', async () => {
    const oldFormatPlan = {
      PK: 'DOG#dog-123',
      SK: 'PLAN#2026-05',
      month: '2026-05',
      whatToDo: [
        { text: 'Do the thing.', videoTopic: 'Puppy Basics' },
      ],
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: oldFormatPlan })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123', 'puppy-basics'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.title).toBe('Puppy Basics');
  });
});
