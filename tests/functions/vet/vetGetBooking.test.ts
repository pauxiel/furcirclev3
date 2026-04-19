const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetBooking';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (bookingId: string, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { bookingId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const booking = {
  PK: 'BOOKING#booking-1', SK: 'BOOKING',
  bookingId: 'booking-1', ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
  assessmentId: 'assess-1', duration: 30, scheduledAt: '2026-05-01T10:00:00Z',
  status: 'upcoming', agoraChannelId: 'furcircle-booking-booking-1', postCallSummary: null,
  createdAt: '2026-04-15T10:00:00Z',
};

const ownerProfile = { PK: 'OWNER#owner-1', SK: 'PROFILE', userId: 'owner-1', firstName: 'Joshua', lastName: 'Smith', email: 'j@example.com' };
const dogProfile = { PK: 'DOG#dog-1', SK: 'PROFILE', dogId: 'dog-1', name: 'Buddy', breed: 'Golden Retriever', ageMonths: 3, wellnessScore: 72 };
const assessment = { PK: 'ASSESSMENT#assess-1', SK: 'ASSESSMENT', assessmentId: 'assess-1', description: 'Separation anxiety...', vetResponse: 'Great detail.' };

describe('vetGetBooking handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('booking-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when vet does not own booking', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...booking, vetId: 'other-vet' } });
    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 200 with full booking context', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: booking });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: { 'furcircle-test': [ownerProfile, dogProfile, assessment] },
    });

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookingId).toBe('booking-1');
    expect(body.owner.firstName).toBe('Joshua');
    expect(body.dog.name).toBe('Buddy');
    expect(body.assessment.assessmentId).toBe('assess-1');
  });
});
