const mockDocClientSend = jest.fn();
const mockGetPresignedPutUrl = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/s3', () => ({
  getPresignedPutUrl: (...args: unknown[]) => mockGetPresignedPutUrl(...args),
}));

import { handler } from '../../../src/functions/vet/vetUploadPhotoUrl';
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

const vetProfile = { PK: 'VET#vet-123', SK: 'PROFILE', vetId: 'vet-123' };

describe('vetUploadPhotoUrl handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['BUCKET_NAME'] = 'furcircle-test-bucket';
    mockGetPresignedPutUrl.mockResolvedValue('https://s3.amazonaws.com/presigned-url');
  });

  it('returns 400 for unsupported content type', async () => {
    const res = (await handler(makeEvent({ contentType: 'image/gif' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_CONTENT_TYPE');
  });

  it('returns 404 when vet not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent({ contentType: 'image/jpeg' }))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('VET_NOT_FOUND');
  });

  it('returns 200 with upload URL for jpeg', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: vetProfile });

    const res = (await handler(makeEvent({ contentType: 'image/jpeg' }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
    expect(body.photoUrl).toContain('vets/vet-123/profile.jpeg');
    expect(body.expiresIn).toBe(300);
  });

  it('returns 200 with upload URL for png', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: vetProfile });

    const res = (await handler(makeEvent({ contentType: 'image/png' }))) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).photoUrl).toContain('profile.png');
  });
});
