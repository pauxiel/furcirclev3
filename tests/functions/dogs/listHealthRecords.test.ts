const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/dogs/listHealthRecords';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
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
};

const fileRecord = {
  PK: 'DOG#dog-123',
  SK: 'HEALTH#vaccination#rec-1',
  dogId: 'dog-123',
  recordId: 'rec-1',
  type: 'vaccination',
  title: 'Rabies vaccine',
  fileKey: 'dogs/dog-123/medical-records/rec-1.pdf',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const manualRecord = {
  PK: 'DOG#dog-123',
  SK: 'HEALTH#vaccination#rec-2',
  dogId: 'dog-123',
  recordId: 'rec-2',
  type: 'vaccination',
  title: 'DHPP',
  vaccineName: 'DHPP',
  nextDueDate: '2026-04-01',
  createdAt: '2026-01-02T00:00:00.000Z',
};

describe('listHealthRecords handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns all health records for a dog', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Items: [fileRecord, manualRecord] });

    const res = await handler(makeEvent('dog-123'));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.records).toHaveLength(2);
    expect(body.records[0].recordId).toBe('rec-1');
    expect(body.records[1].vaccineName).toBe('DHPP');
  });

  it('returns empty array when no health records exist', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('dog-123'));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.records).toEqual([]);
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', 'attacker'));

    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing'));

    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 when dogId missing', async () => {
    const event = makeEvent('');
    event.pathParameters = {};

    const res = await handler(event);

    expect((res as { statusCode: number }).statusCode).toBe(400);
  });
});
