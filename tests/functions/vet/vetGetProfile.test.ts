const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetProfile';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const vetProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Emma',
  lastName: 'Clarke',
  email: 'emma@furcircle.com',
  providerType: 'behaviourist',
  specialisation: 'Puppy behaviour',
  bio: 'Dr Emma Clarke has 8 years experience...',
  photoUrl: 'https://example.com/emma.jpg',
  rating: 4.9,
  reviewCount: 71,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('vetGetProfile handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when vet profile not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('VET_NOT_FOUND');
  });

  it('returns 200 with full vet profile', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: vetProfile });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vetId).toBe('vet-123');
    expect(body.firstName).toBe('Emma');
    expect(body.providerType).toBe('behaviourist');
    expect(body.rating).toBe(4.9);
    expect(body.isActive).toBe(true);
  });
});
