const mockDocClientSend = jest.fn();
const mockGetStripe = jest.fn();
const mockPaymentIntentsCreate = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/stripe', () => ({
  getStripe: () => mockGetStripe(),
}));

import { handler } from '../../../src/functions/subscriptions/topUpCredits';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (body: Record<string, unknown>, userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const subRecord = { plan: 'proactive', creditBalance: 40, stripeCustomerId: 'cus_123' };

describe('topUpCredits handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStripe.mockResolvedValue({ paymentIntents: { create: mockPaymentIntentsCreate } });
    mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_abc', status: 'succeeded' });
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRecord })
      .mockResolvedValueOnce({ Attributes: { creditBalance: 60 } });
  });

  it('returns 400 for invalid credits value', async () => {
    const result = (await handler(makeEvent({ credits: 7, paymentMethodId: 'pm_x' }))) as Result;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_CREDIT_PACKAGE');
  });

  it('returns 400 for credits=0', async () => {
    const result = (await handler(makeEvent({ credits: 0, paymentMethodId: 'pm_x' }))) as Result;
    expect(result.statusCode).toBe(400);
  });

  it('creates PaymentIntent with correct amount for 20 credits ($18.00 = 1800 cents)', async () => {
    await handler(makeEvent({ credits: 20, paymentMethodId: 'pm_test' }));
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1800, currency: 'usd', customer: 'cus_123' }),
    );
  });

  it('creates PaymentIntent with correct amount for 10 credits ($10.00 = 1000 cents)', async () => {
    await handler(makeEvent({ credits: 10, paymentMethodId: 'pm_test' }));
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
  });

  it('creates PaymentIntent with correct amount for 50 credits ($40.00 = 4000 cents)', async () => {
    await handler(makeEvent({ credits: 50, paymentMethodId: 'pm_test' }));
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 4000 }));
  });

  it('returns 200 with creditsAdded and updated creditBalance', async () => {
    const result = (await handler(makeEvent({ credits: 20, paymentMethodId: 'pm_test' }))) as Result;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.creditsAdded).toBe(20);
    expect(typeof body.creditBalance).toBe('number');
  });

  it('returns 400 when paymentMethodId missing', async () => {
    const result = (await handler(makeEvent({ credits: 20 }))) as Result;
    expect(result.statusCode).toBe(400);
  });
});
