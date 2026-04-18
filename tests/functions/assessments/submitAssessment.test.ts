const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock('uuid', () => ({ v4: () => 'assess-uuid-123' }));

import { handler } from '../../../src/functions/assessments/submitAssessment';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    pathParameters: {},
    queryStringParameters: undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validBody = {
  vetId: 'vet-123',
  dogId: 'dog-123',
  description: 'Buddy has been showing signs of separation anxiety since we moved apartments last month.',
  mediaUrls: ['https://furcircle-dog-photos-prod.s3.amazonaws.com/assessments/uuid/video1.mp4'],
};

describe('submitAssessment handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:furcircle-test';
  });

  it('returns 400 when description is shorter than 50 chars', async () => {
    const res = (await handler(makeEvent({ ...validBody, description: 'Too short' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when mediaUrls has more than 3 items', async () => {
    const urls = Array(4).fill('https://furcircle-dog-photos-prod.s3.amazonaws.com/assessments/x/v.mp4');
    const res = (await handler(makeEvent({ ...validBody, mediaUrls: urls }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when mediaUrl is not under assessments/ path', async () => {
    const res = (await handler(
      makeEvent({ ...validBody, mediaUrls: ['https://furcircle-dog-photos-prod.s3.amazonaws.com/dogs/photo.jpg'] }),
    )) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 409 when pending or approved assessment already exists', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [{ assessmentId: 'existing', status: 'pending' }],
    });

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('ASSESSMENT_EXISTS');
  });

  it('returns 201 and creates ASSESSMENT record with status=pending', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [] })  // GSI1 check — no existing
      .mockResolvedValueOnce({});             // PutItem

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.assessmentId).toBe('assess-uuid-123');
    expect(body.status).toBe('pending');
    expect(body.vetId).toBe('vet-123');

    const putCall = mockDocClientSend.mock.calls[1][0];
    const item = (putCall.input ?? putCall).Item;
    expect(item.PK).toBe('ASSESSMENT#assess-uuid-123');
    expect(item.SK).toBe('ASSESSMENT');
    expect(item.GSI1PK).toBe('OWNER#owner-123');
    expect(item.GSI1SK).toBe('ASSESSMENT#vet-123');
    expect(item.GSI2PK).toBe('VET#vet-123');
    expect(item.status).toBe('pending');
  });

  it('returns 201 even when SNS publish fails', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    mockSnsSend.mockRejectedValueOnce(new Error('SNS unavailable'));

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(201);
  });
});
