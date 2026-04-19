const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/providers/getProviderAssessment';
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

const assessmentRow = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  GSI1PK: 'OWNER#owner-123',
  GSI1SK: 'ASSESSMENT#vet-123',
  assessmentId: 'assess-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  dogId: 'dog-123',
  status: 'approved',
  description: 'Buddy shows separation anxiety...',
  mediaUrls: ['https://example.com/video.mp4'],
  vetResponse: 'This is classic separation anxiety.',
  createdAt: '2026-04-10T10:00:00Z',
  reviewedAt: '2026-04-11T09:00:00Z',
};

describe('getProviderAssessment handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when owner has no assessment for this vet', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent('vet-123'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 200 with assessment data when found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [assessmentRow] });

    const res = (await handler(makeEvent('vet-123'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assessmentId).toBe('assess-1');
    expect(body.status).toBe('approved');
    expect(body.vetResponse).toBe('This is classic separation anxiety.');
    expect(body.reviewedAt).toBe('2026-04-11T09:00:00Z');
  });

  it('queries GSI1 with authenticated owner userId', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [assessmentRow] });

    await handler(makeEvent('vet-123', 'owner-456'));

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCall.input.ExpressionAttributeValues[':pk']).toBe('OWNER#owner-456');
    expect(queryCall.input.ExpressionAttributeValues[':sk']).toBe('ASSESSMENT#vet-123');
  });
});
