/**
 * Unit tests for src/lib/stripe.ts
 */

describe('stripe.getStripe', () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    process.env['STAGE'] = 'test';
    mockSend = jest.fn();
  });

  afterEach(() => {
    delete process.env['STAGE'];
  });

  const loadModule = () => {
    jest.doMock('@aws-sdk/client-ssm', () => ({
      SSMClient: jest.fn(() => ({ send: mockSend })),
      GetParameterCommand: jest.fn((input: unknown) => input),
    }));
    jest.doMock('stripe', () =>
      jest.fn().mockImplementation(() => ({ _isStripe: true })),
    );
    return require('../../src/lib/stripe') as { getStripe: () => Promise<unknown> };
  };

  it('calls SSM GetParameter with correct path and decryption', async () => {
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'sk_test_fake' } });

    const { getStripe } = loadModule();
    await getStripe();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0] as Record<string, unknown>;
    expect(command['Name']).toBe('/furcircle/test/stripe/secretKey');
    expect(command['WithDecryption']).toBe(true);
  });

  it('constructs Stripe with the key returned from SSM', async () => {
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'sk_test_abc123' } });
    const StripeMock = jest.fn().mockImplementation(() => ({ _isStripe: true }));
    jest.resetModules();
    jest.doMock('@aws-sdk/client-ssm', () => ({
      SSMClient: jest.fn(() => ({ send: mockSend })),
      GetParameterCommand: jest.fn((input: unknown) => input),
    }));
    jest.doMock('stripe', () => StripeMock);

    const { getStripe } = require('../../src/lib/stripe') as {
      getStripe: () => Promise<unknown>;
    };
    await getStripe();

    expect(StripeMock).toHaveBeenCalledWith('sk_test_abc123', expect.any(Object));
  });

  it('returns a non-null Stripe instance', async () => {
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'sk_test_fake' } });

    const { getStripe } = loadModule();
    const stripe = await getStripe();

    expect(stripe).toBeDefined();
    expect(stripe).not.toBeNull();
  });

  it('caches the instance — SSM called only once across multiple getStripe() calls', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'sk_test_fake' } });

    const { getStripe } = loadModule();
    await getStripe();
    await getStripe();
    await getStripe();

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('uses dev stage when STAGE env var is not set', async () => {
    delete process.env['STAGE'];
    mockSend.mockResolvedValueOnce({ Parameter: { Value: 'sk_test_fake' } });

    const { getStripe } = loadModule();
    await getStripe();

    const command = mockSend.mock.calls[0][0] as Record<string, unknown>;
    expect(command['Name']).toBe('/furcircle/dev/stripe/secretKey');
  });
});
