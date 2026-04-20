/**
 * Unit tests for POST /dogs/{dogId}/photo
 */

const mockDocClientSend = jest.fn();
const mockGetPresignedPutUrl = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/s3', () => ({
  getPresignedPutUrl: (...args: unknown[]) => mockGetPresignedPutUrl(...args),
}));

import { handler } from '../../../src/functions/dogs/getDogPhotoUrl';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  planStatus: 'ready',
};

describe('getDogPhotoUrl handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['BUCKET_NAME'] = 'furcircle-photos-test';
  });

  it('returns 200 with uploadUrl and photoUrl', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });
    mockGetPresignedPutUrl.mockResolvedValueOnce('https://s3.amazonaws.com/presigned-url');

    const res = await handler(makeEvent('dog-123', { contentType: 'image/jpeg' }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
    expect(body.photoUrl).toMatch(/dogs\/dog-123\/profile\.(jpg|jpeg)/);
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', { contentType: 'image/jpeg' }, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing', { contentType: 'image/jpeg' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 when contentType missing', async () => {
    const res = await handler(makeEvent('dog-123', {}));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 for unsupported contentType', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    const res = await handler(makeEvent('dog-123', { contentType: 'application/pdf' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('calls getPresignedPutUrl with correct key and 300s expiry', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });
    mockGetPresignedPutUrl.mockResolvedValueOnce('https://s3.amazonaws.com/url');

    await handler(makeEvent('dog-123', { contentType: 'image/png' }));

    expect(mockGetPresignedPutUrl).toHaveBeenCalledWith(
      'furcircle-photos-test',
      expect.stringMatching(/^dogs\/dog-123\/profile\.png$/),
      'image/png',
      300,
    );
  });
});
