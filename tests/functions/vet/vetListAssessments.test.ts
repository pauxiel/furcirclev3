const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetListAssessments';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  qs: Record<string, string> = {},
  vetId = 'vet-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const assessmentItem = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  assessmentId: 'assess-1',
  ownerId: 'owner-1',
  vetId: 'vet-123',
  dogId: 'dog-1',
  description: 'Buddy shows separation anxiety...',
  mediaUrls: [],
  status: 'pending',
  createdAt: '2026-04-15T10:00:00Z',
  GSI2PK: 'VET#vet-123',
  GSI2SK: 'ASSESSMENT#pending#2026-04-15T10:00:00Z',
};

const ownerProfile = {
  PK: 'OWNER#owner-1',
  SK: 'PROFILE',
  userId: 'owner-1',
  firstName: 'Joshua',
  lastName: 'Smith',
};

const dogProfile = {
  PK: 'DOG#dog-1',
  SK: 'PROFILE',
  dogId: 'dog-1',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
};

describe('vetListAssessments handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 for invalid status param', async () => {
    const res = (await handler(makeEvent({ status: 'invalid' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('returns empty list when no assessments', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).assessments).toHaveLength(0);
  });

  it('returns assessments with owner and dog enriched', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [assessmentItem] });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: {
        'furcircle-test': [ownerProfile, dogProfile],
      },
    });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assessments).toHaveLength(1);
    expect(body.assessments[0].owner.firstName).toBe('Joshua');
    expect(body.assessments[0].dog.name).toBe('Buddy');
    expect(body.assessments[0].assessmentId).toBe('assess-1');
  });

  it('defaults to pending status', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent());

    const callArgs = mockDocClientSend.mock.calls[0][0].input;
    expect(callArgs.ExpressionAttributeValues[':sk']).toBe('ASSESSMENT#pending#');
  });

  it('filters by approved status when specified', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ status: 'approved' }));

    const callArgs = mockDocClientSend.mock.calls[0][0].input;
    expect(callArgs.ExpressionAttributeValues[':sk']).toBe('ASSESSMENT#approved#');
  });
});
