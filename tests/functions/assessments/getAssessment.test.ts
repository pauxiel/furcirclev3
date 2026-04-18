const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/assessments/getAssessment';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  assessmentId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { assessmentId },
    queryStringParameters: undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const assessmentRow = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  assessmentId: 'assess-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  dogId: 'dog-123',
  providerType: 'behaviourist',
  status: 'approved',
  description: 'Buddy has been showing separation anxiety for weeks.',
  mediaUrls: ['https://example.com/assessments/video.mp4'],
  vetResponse: 'This is classic separation anxiety.',
  createdAt: '2026-04-10T10:00:00Z',
  reviewedAt: '2026-04-11T09:00:00Z',
};

describe('getAssessment handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when assessment not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('assess-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when ownerId does not match authenticated user', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: assessmentRow });

    const res = (await handler(makeEvent('assess-1', 'other-owner'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 200 with full assessment data', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: assessmentRow });

    const res = (await handler(makeEvent('assess-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assessmentId).toBe('assess-1');
    expect(body.status).toBe('approved');
    expect(body.description).toBe('Buddy has been showing separation anxiety for weeks.');
    expect(body.mediaUrls).toHaveLength(1);
  });

  it('returns vetResponse and reviewedAt when assessment is reviewed', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: assessmentRow });

    const res = (await handler(makeEvent('assess-1'))) as Result;
    const body = JSON.parse(res.body);
    expect(body.vetResponse).toBe('This is classic separation anxiety.');
    expect(body.reviewedAt).toBe('2026-04-11T09:00:00Z');
  });
});
