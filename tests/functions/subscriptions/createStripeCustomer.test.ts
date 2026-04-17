const mockDocClientSend = jest.fn();
const mockGetStripe = jest.fn();
const mockCustomersCreate = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/stripe', () => ({
  getStripe: () => mockGetStripe(),
}));

import { handler } from '../../../src/functions/subscriptions/createStripeCustomer';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: '{}',
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const profileItem = { PK: 'OWNER#owner-123', SK: 'PROFILE', userId: 'owner-123', email: 'test@example.com', firstName: 'Josh', lastName: 'Smith' };
const subNoCustomer = { PK: 'OWNER#owner-123', SK: 'SUBSCRIPTION', plan: 'welcome', creditBalance: 0 };
const subWithCustomer = { ...subNoCustomer, stripeCustomerId: 'cus_existing' };

describe('createStripeCustomer handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStripe.mockResolvedValue({ customers: { create: mockCustomersCreate } });
  });

  it('returns existing stripeCustomerId without calling Stripe (idempotent)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: profileItem })
      .mockResolvedValueOnce({ Item: subWithCustomer });

    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ stripeCustomerId: 'cus_existing' });
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it('creates Stripe customer with owner email and name', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: profileItem })
      .mockResolvedValueOnce({ Item: subNoCustomer })
      .mockResolvedValueOnce({});

    mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_new123' });

    await handler(makeEvent());

    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', name: 'Josh Smith' }),
    );
  });

  it('saves stripeCustomerId to DynamoDB and returns it', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: profileItem })
      .mockResolvedValueOnce({ Item: subNoCustomer })
      .mockResolvedValueOnce({});

    mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_new123' });

    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ stripeCustomerId: 'cus_new123' });
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('returns 404 when owner profile not found', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: subNoCustomer });

    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(404);
  });
});
