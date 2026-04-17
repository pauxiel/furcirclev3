const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/providers/getProvider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  vetId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { vetId },
    queryStringParameters: undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const vetRow = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Emma',
  lastName: 'Clarke',
  providerType: 'behaviourist',
  specialisation: 'Puppy behaviour',
  bio: 'Dr. Emma Clarke has 8 years experience',
  photoUrl: 'https://example.com/emma.jpg',
  rating: 4.9,
  reviewCount: 71,
  isActive: true,
};

const subRow = { PK: 'OWNER#owner-123', SK: 'SUBSCRIPTION', plan: 'proactive', creditBalance: 70 };
const availRow = {
  PK: 'VET#vet-123',
  SK: 'AVAIL#2026-04-18',
  vetId: 'vet-123',
  date: '2026-04-18',
  slots: [{ time: '10:00', available: true, duration: [15, 30] }],
};

describe('getProvider handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when vet not found', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: undefined })   // vet GetItem
      .mockResolvedValueOnce({ Item: subRow })       // subscription
      .mockResolvedValueOnce({ Items: [] })           // assessment
      .mockResolvedValueOnce({ Items: [] });          // availability

    const res = (await handler(makeEvent('vet-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 200 with provider profile + assessmentStatus + nextAvailable', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: vetRow })
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [availRow] });

    const res = (await handler(makeEvent('vet-123'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vetId).toBe('vet-123');
    expect(body.bio).toBe('Dr. Emma Clarke has 8 years experience');
    expect(body.assessmentStatus).toBe('none');
    expect(body.availability.nextAvailable).toBe('2026-04-18');
  });

  it('assessmentStatus=pending when owner has pending assessment', async () => {
    const pendingAssessment = {
      PK: 'ASSESSMENT#a-1', SK: 'ASSESSMENT',
      GSI1PK: 'OWNER#owner-123', GSI1SK: 'ASSESSMENT#vet-123',
      assessmentId: 'a-1', vetId: 'vet-123', status: 'pending',
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: vetRow })
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Items: [pendingAssessment] })
      .mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent('vet-123'))) as Result;
    const body = JSON.parse(res.body);
    expect(body.assessmentStatus).toBe('pending');
    expect(body.canBook).toBe(false);
  });
});
