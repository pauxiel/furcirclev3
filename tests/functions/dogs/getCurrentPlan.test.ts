/**
 * Unit tests for GET /dogs/{dogId}/plan
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/dogs/getCurrentPlan';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (dogId: string, userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
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
  planStatus: 'ready',
  wellnessScore: 72,
};

const planRecord = {
  PK: 'DOG#dog-123',
  SK: 'PLAN#2026-04',
  dogId: 'dog-123',
  month: '2026-04',
  ageMonthsAtPlan: 3,
  whatToExpect: 'Peak learning period.',
  whatToDo: [{ text: 'Teach sit' }],
  whatNotToDo: [{ text: 'No off-leash parks' }],
  watchFor: [{ text: 'Excessive hiding' }],
  earlyWarningSigns: [{ text: 'Persistent limping', action: 'See a vet.' }],
  comingUpNextMonth: 'Month 4.',
  milestones: [
    { emoji: '🐾', title: 'Socialisation', description: 'Critical window.' },
    { emoji: '🎓', title: 'Basic commands', description: 'Sit, come.' },
    { emoji: '🦷', title: 'Bite inhibition', description: 'Mouthing.' },
  ],
  wellnessScore: 72,
  generatedAt: '2026-04-15T10:30:00Z',
};

describe('getCurrentPlan handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with plan when ready', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile }) // dog profile
      .mockResolvedValueOnce({ Item: planRecord }); // plan record

    const res = await handler(makeEvent('dog-123'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogId).toBe('dog-123');
    expect(body.month).toBe('2026-04');
    expect(body.wellnessScore).toBe(72);
    expect(body.whatToExpect).toBe('Peak learning period.');
  });

  it('returns 200 with planStatus=generating when plan not yet ready', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...dogProfile, planStatus: 'generating' },
    });

    const res = await handler(makeEvent('dog-123'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.planStatus).toBe('generating');
    expect(body.dogId).toBe('dog-123');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('DOG_NOT_FOUND');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when plan record does not exist', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: undefined }); // no plan yet

    const res = await handler(makeEvent('dog-123'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });
});
