/**
 * Unit tests for GET /dogs/{dogId} and GET /dogs
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler as getDogHandler } from '../../../src/functions/dogs/getDog';
import { handler as listDogsHandler } from '../../../src/functions/dogs/listDogs';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeGetDogEvent = (dogId: string, userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const makeListEvent = (userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
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
  breed: 'Golden Retriever',
  ageMonths: 3,
  planStatus: 'ready',
  wellnessScore: 72,
  createdAt: '2026-04-15T10:00:00Z',
};

describe('getDog handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with dog profile and empty healthRecords', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Items: [] });

    const res = await getDogHandler(makeGetDogEvent('dog-123'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogId).toBe('dog-123');
    expect(body.name).toBe('Buddy');
    expect(body.healthRecords).toEqual([]);
  });

  it('returns 200 with healthRecords when present', async () => {
    const healthRecord = { SK: 'HEALTH#vaccination#rec-1', type: 'vaccination', title: 'Vaccinations' };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Items: [healthRecord] });

    const res = await getDogHandler(makeGetDogEvent('dog-123'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.healthRecords).toHaveLength(1);
    expect(body.healthRecords[0].type).toBe('vaccination');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await getDogHandler(makeGetDogEvent('nonexistent'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('DOG_NOT_FOUND');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...dogProfile, ownerId: 'other-owner' },
    });

    const res = await getDogHandler(makeGetDogEvent('dog-123', 'attacker-456'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('FORBIDDEN');
  });
});

describe('listDogs handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with dogs array from GSI1 query', async () => {
    mockDocClientSend.mockResolvedValue({
      Items: [dogProfile, { ...dogProfile, dogId: 'dog-456', name: 'Max' }],
    });

    const res = await listDogsHandler(makeListEvent());
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogs).toHaveLength(2);
    expect(body.dogs[0].name).toBe('Buddy');
  });

  it('returns empty dogs array when owner has no dogs', async () => {
    mockDocClientSend.mockResolvedValue({ Items: [] });

    const res = await listDogsHandler(makeListEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogs).toEqual([]);
  });

  it('queries GSI1 with correct owner prefix', async () => {
    mockDocClientSend.mockResolvedValue({ Items: [] });

    await listDogsHandler(makeListEvent('owner-xyz'));

    const cmd = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    const values = Object.values(cmd.input.ExpressionAttributeValues);
    expect(values).toContain('OWNER#owner-xyz');
  });
});
