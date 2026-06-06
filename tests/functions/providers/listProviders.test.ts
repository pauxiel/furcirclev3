const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/providers/listProviders';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  params: Record<string, string> = {},
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    queryStringParameters: Object.keys(params).length ? params : undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const vetRow = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  GSI3PK: 'PROVIDER_TYPE#behaviourist',
  GSI3SK: 'RATING#4.9#VET#vet-123',
  vetId: 'vet-123',
  firstName: 'Emma',
  lastName: 'Clarke',
  providerType: 'behaviourist',
  specialisation: 'Puppy behaviour',
  photoUrl: 'https://example.com/emma.jpg',
  rating: 4.9,
  reviewCount: 71,
  isActive: true,
};

const subRow = { PK: 'OWNER#owner-123', SK: 'SUBSCRIPTION', plan: 'proactive', creditBalance: 70 };
const assessmentRow = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  GSI1PK: 'OWNER#owner-123',
  GSI1SK: 'ASSESSMENT#vet-123',
  assessmentId: 'assess-1',
  vetId: 'vet-123',
  status: 'approved',
};

describe('listProviders handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 when type param missing', async () => {
    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_TYPE');
  });

  it('returns 400 when type param invalid', async () => {
    const res = (await handler(makeEvent({ type: 'surgeon' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_TYPE');
  });

  it('returns 200 with providers list and assessmentStatus=none when no assessment', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [vetRow] })               // GSI3 query
      .mockResolvedValueOnce({ Item: subRow })                   // subscription GetItem
      .mockResolvedValueOnce({ Items: [] });                     // assessment query for vet-123

    const res = (await handler(makeEvent({ type: 'behaviourist' }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].assessmentStatus).toBe('none');
    expect(body.providers[0].canBook).toBe(false);
  });

  it('canBook=true for proactive owner with approved behaviourist assessment', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [vetRow] })
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Items: [assessmentRow] });

    const res = (await handler(makeEvent({ type: 'behaviourist' }))) as Result;
    const body = JSON.parse(res.body);
    expect(body.providers[0].assessmentStatus).toBe('approved');
    expect(body.providers[0].canBook).toBe(true);
  });

  it('canBook=false for non-proactive owner even if assessment approved', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [vetRow] })
      .mockResolvedValueOnce({ Item: { ...subRow, plan: 'protector' } })
      .mockResolvedValueOnce({ Items: [assessmentRow] });

    const res = (await handler(makeEvent({ type: 'behaviourist' }))) as Result;
    const body = JSON.parse(res.body);
    expect(body.providers[0].canBook).toBe(false);
  });

  it('lists veterinarians without booking/assessment coupling', async () => {
    const vetVet = {
      ...vetRow,
      providerType: 'veterinarian',
      GSI3PK: 'PROVIDER_TYPE#veterinarian',
      GSI3SK: 'RATING#4.8#VET#vet-123',
      rating: 4.8,
    };
    mockDocClientSend.mockResolvedValueOnce({ Items: [vetVet] }); // GSI3 query only

    const res = (await handler(makeEvent({ type: 'veterinarian' }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].vetId).toBe('vet-123');
    expect(body.providers[0].providerType).toBe('veterinarian');
    expect(body.providers[0].canBook).toBeUndefined();
    expect(body.providers[0].assessmentStatus).toBeUndefined();
    // no subscription or assessment lookups for vets
    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
  });

  it('returns empty list when no veterinarians and makes no extra lookups', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent({ type: 'veterinarian' }))) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).providers).toEqual([]);
    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
  });
});
