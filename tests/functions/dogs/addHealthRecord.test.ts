const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/dogs/addHealthRecord';
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
  name: 'Buddy',
};

describe('addHealthRecord handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('saves a file-based health record (Mode 1)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent('dog-123', {
      recordId: 'rec-1',
      fileKey: 'dogs/dog-123/records/rec-1.pdf',
      type: 'vaccination',
      title: 'Rabies vaccine',
    }));

    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.fileKey).toBe('dogs/dog-123/records/rec-1.pdf');
    expect(body.type).toBe('vaccination');
  });

  it('saves a manual vaccination record with nextDueDate (Mode 2)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent('dog-123', {
      recordId: 'rec-2',
      type: 'vaccination',
      vaccineName: 'DHPP',
      nextDueDate: '2026-04-01',
    }));

    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.vaccineName).toBe('DHPP');
    expect(body.nextDueDate).toBe('2026-04-01');
    expect(body.fileKey).toBeUndefined();
  });

  it('returns 400 when neither fileKey nor nextDueDate provided', async () => {
    const res = await handler(makeEvent('dog-123', {
      recordId: 'rec-3',
      type: 'vaccination',
    }));

    expect((res as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', {
      recordId: 'rec-4',
      type: 'vaccination',
      nextDueDate: '2026-04-01',
    }, 'attacker'));

    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing', {
      recordId: 'rec-5',
      type: 'vaccination',
      nextDueDate: '2026-04-01',
    }));

    expect((res as { statusCode: number }).statusCode).toBe(404);
  });
});
