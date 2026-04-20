const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/vet/vetRespondToAssessment';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  assessmentId: string,
  body: Record<string, unknown>,
  vetId = 'vet-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { assessmentId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validResponse = 'This is a detailed response that meets the minimum character requirement for vet responses.';

const pendingAssessment = {
  PK: 'ASSESSMENT#assess-1',
  SK: 'ASSESSMENT',
  assessmentId: 'assess-1',
  ownerId: 'owner-1',
  vetId: 'vet-123',
  dogId: 'dog-1',
  status: 'pending',
  createdAt: '2026-04-15T10:00:00Z',
};

describe('vetRespondToAssessment handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:test-topic';
    mockSnsSend.mockResolvedValue({});
  });

  it('returns 400 when decision is invalid', async () => {
    const res = (await handler(makeEvent('assess-1', { decision: 'maybe', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when response is too short', async () => {
    const res = (await handler(makeEvent('assess-1', { decision: 'approved', response: 'Too short' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('RESPONSE_TOO_SHORT');
  });

  it('returns 404 when assessment not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('assess-999', { decision: 'approved', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when vet does not own assessment', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...pendingAssessment, vetId: 'other-vet' } });

    const res = (await handler(makeEvent('assess-1', { decision: 'approved', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when assessment already responded to', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...pendingAssessment, status: 'approved' } });

    const res = (await handler(makeEvent('assess-1', { decision: 'approved', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('ALREADY_RESPONDED');
  });

  it('returns 200 on successful approval', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: pendingAssessment });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent('assess-1', { decision: 'approved', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('approved');
    expect(body.assessmentId).toBe('assess-1');
    expect(body.reviewedAt).toBeDefined();
  });

  it('returns 200 on rejection', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: pendingAssessment });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent('assess-1', { decision: 'rejected', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('rejected');
  });

  it('does not fail when SNS publish fails', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: pendingAssessment });
    mockDocClientSend.mockResolvedValueOnce({});
    mockSnsSend.mockRejectedValueOnce(new Error('SNS down'));

    const res = (await handler(makeEvent('assess-1', { decision: 'approved', response: validResponse }))) as Result;
    expect(res.statusCode).toBe(200);
  });
});
