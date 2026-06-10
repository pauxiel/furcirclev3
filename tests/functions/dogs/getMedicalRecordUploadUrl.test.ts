/**
 * Unit tests for GET /dogs/{dogId}/medical-record-url?contentType=...
 */

const mockDocClientSend = jest.fn();
const mockGetPresignedPutUrl = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/s3', () => ({
  getPresignedPutUrl: (...args: unknown[]) => mockGetPresignedPutUrl(...args),
}));

jest.mock('uuid', () => ({ v4: () => 'test-record-uuid' }));

import { handler } from '../../../src/functions/dogs/getMedicalRecordUploadUrl';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  query: Record<string, string>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    queryStringParameters: query,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
};

describe('getMedicalRecordUploadUrl handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['BUCKET_NAME'] = 'furcircle-test-bucket';
    mockGetPresignedPutUrl.mockResolvedValue('https://s3.presigned.example.com/upload');
  });

  it('returns 200 with uploadUrl, recordId, fileKey for image/jpeg', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    const res = await handler(makeEvent('dog-123', { contentType: 'image/jpeg' }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.uploadUrl).toBe('https://s3.presigned.example.com/upload');
    expect(body.recordId).toBe('test-record-uuid');
    expect(body.fileKey).toBe('dogs/dog-123/medical-records/test-record-uuid.jpeg');
  });

  it('fileKey uses correct extension for application/pdf', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    const res = await handler(makeEvent('dog-123', { contentType: 'application/pdf' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.fileKey).toBe('dogs/dog-123/medical-records/test-record-uuid.pdf');
  });

  it('calls getPresignedPutUrl with correct args', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    await handler(makeEvent('dog-123', { contentType: 'image/png' }));

    expect(mockGetPresignedPutUrl).toHaveBeenCalledWith(
      'furcircle-test-bucket',
      'dogs/dog-123/medical-records/test-record-uuid.png',
      'image/png',
      300,
    );
  });

  it('returns 400 when contentType missing', async () => {
    const res = await handler(makeEvent('dog-123', {}));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(JSON.parse((res as { body: string }).body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for unsupported contentType', async () => {
    const res = await handler(makeEvent('dog-123', { contentType: 'video/mp4' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('Unsupported contentType');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing-dog', { contentType: 'image/jpeg' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('DOG_NOT_FOUND');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other-owner' } });

    const res = await handler(makeEvent('dog-123', { contentType: 'image/jpeg' }, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when no query parameters present', async () => {
    const res = await handler({
      pathParameters: { dogId: 'dog-123' },
      queryStringParameters: undefined,
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'owner-123' }, scopes: [] }, principalId: '', integrationLatency: 0 },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });
});
