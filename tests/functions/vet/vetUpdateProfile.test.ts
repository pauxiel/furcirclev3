const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetUpdateProfile';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (body: Record<string, unknown>, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    pathParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const updatedProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Emma',
  lastName: 'Clarke',
  email: 'emma@furcircle.com',
  providerType: 'behaviourist',
  specialisation: 'Puppy behaviour updated',
  bio: 'Updated bio text.',
  photoUrl: 'https://example.com/emma.jpg',
  rating: 4.9,
  reviewCount: 71,
  isActive: false,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('vetUpdateProfile handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = {
      body: 'not-json',
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'vet-123' }, scopes: [] }, principalId: '', integrationLatency: 0 },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const res = (await handler(event)) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if no valid fields provided', async () => {
    const res = (await handler(makeEvent({ unknownField: 'value' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when vet not found (condition check fails)', async () => {
    mockDocClientSend.mockRejectedValueOnce(
      Object.assign(new Error('ConditionalCheckFailed'), { name: 'ConditionalCheckFailedException' }),
    );

    const res = (await handler(makeEvent({ bio: 'Updated bio text for testing.' }))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('VET_NOT_FOUND');
  });

  it('returns 200 with updated profile', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Attributes: updatedProfile });

    const res = (await handler(makeEvent({ bio: 'Updated bio text.', isActive: false }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isActive).toBe(false);
    expect(body.bio).toBe('Updated bio text.');
  });
});
