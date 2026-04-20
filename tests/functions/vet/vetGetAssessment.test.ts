const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetAssessment';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (assessmentId: string, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { assessmentId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const assessment = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  assessmentId: 'assess-1',
  ownerId: 'owner-1',
  vetId: 'vet-123',
  dogId: 'dog-1',
  description: 'Buddy shows separation anxiety since we moved.',
  mediaUrls: [],
  status: 'pending',
  vetResponse: null,
  reviewedAt: null,
  createdAt: '2026-04-15T10:00:00Z',
};

const ownerProfile = {
  PK: 'OWNER#owner-1',
  SK: 'PROFILE',
  userId: 'owner-1',
  firstName: 'Joshua',
  lastName: 'Smith',
  email: 'joshua@example.com',
};

const dogProfile = {
  PK: 'DOG#dog-1',
  SK: 'PROFILE',
  dogId: 'dog-1',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  wellnessScore: 72,
};

describe('vetGetAssessment handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 when assessmentId missing', async () => {
    const event = {
      pathParameters: {},
      requestContext: { authorizer: { jwt: { claims: { sub: 'vet-123' }, scopes: [] }, principalId: '', integrationLatency: 0 } },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const res = (await handler(event)) as Result;
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when assessment not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('assess-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when vet does not own assessment', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...assessment, vetId: 'other-vet' } });

    const res = (await handler(makeEvent('assess-1'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 200 with enriched assessment', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: assessment });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: { 'furcircle-test': [ownerProfile, dogProfile] },
    });

    const res = (await handler(makeEvent('assess-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assessmentId).toBe('assess-1');
    expect(body.owner.firstName).toBe('Joshua');
    expect(body.dog.name).toBe('Buddy');
    expect(body.dog.ageMonths).toBe(3);
  });
});
