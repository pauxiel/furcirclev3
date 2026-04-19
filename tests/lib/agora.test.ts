/**
 * Unit tests for src/lib/agora.ts
 */

describe('agora.generateRtcToken', () => {
  let mockSend: jest.Mock;
  let mockBuildToken: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    process.env['STAGE'] = 'test';
    mockSend = jest.fn();
    mockBuildToken = jest.fn().mockReturnValue('006mockAgoraToken');
  });

  afterEach(() => {
    delete process.env['STAGE'];
  });

  const loadModule = () => {
    jest.doMock('@aws-sdk/client-ssm', () => ({
      SSMClient: jest.fn(() => ({ send: mockSend })),
      GetParameterCommand: jest.fn((input: unknown) => input),
    }));
    jest.doMock('agora-token', () => ({
      RtcTokenBuilder: { buildTokenWithUid: mockBuildToken },
      RtcRole: { PUBLISHER: 1 },
    }));
    return require('../../src/lib/agora') as {
      generateRtcToken: (channel: string, uid: number, expiry: number) => Promise<{ token: string; appId: string }>;
    };
  };

  const stubSsm = () => {
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: 'test-app-id' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'test-app-cert' } });
  };

  it('fetches appId and appCertificate from SSM on first call', async () => {
    stubSsm();
    const { generateRtcToken } = loadModule();
    await generateRtcToken('furcircle-booking-abc', 12345, 3600);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const calls = mockSend.mock.calls.map((c) => (c[0] as Record<string, unknown>)['Name']);
    expect(calls).toContain('/furcircle/test/agora/appId');
    expect(calls).toContain('/furcircle/test/agora/appCertificate');
  });

  it('returns token and appId', async () => {
    stubSsm();
    const { generateRtcToken } = loadModule();
    const result = await generateRtcToken('furcircle-booking-abc', 12345, 3600);

    expect(result.token).toBe('006mockAgoraToken');
    expect(result.appId).toBe('test-app-id');
  });

  it('passes correct args to RtcTokenBuilder.buildTokenWithUid', async () => {
    stubSsm();
    const { generateRtcToken } = loadModule();
    await generateRtcToken('furcircle-booking-xyz', 99999, 3600);

    expect(mockBuildToken).toHaveBeenCalledWith(
      'test-app-id',
      'test-app-cert',
      'furcircle-booking-xyz',
      99999,
      1, // RtcRole.PUBLISHER
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('sets token expiry to approximately now + expirySeconds', async () => {
    stubSsm();
    const before = Math.floor(Date.now() / 1000);
    const { generateRtcToken } = loadModule();
    await generateRtcToken('channel', 1, 3600);
    const after = Math.floor(Date.now() / 1000);

    const expireArg = mockBuildToken.mock.calls[0][5] as number;
    expect(expireArg).toBeGreaterThanOrEqual(before + 3600);
    expect(expireArg).toBeLessThanOrEqual(after + 3600);
  });

  it('caches SSM credentials — only calls SSM once across multiple generateRtcToken calls', async () => {
    stubSsm();
    const { generateRtcToken } = loadModule();
    await generateRtcToken('channel-1', 1, 3600);
    await generateRtcToken('channel-2', 2, 3600);

    expect(mockSend).toHaveBeenCalledTimes(2); // 2 params fetched once, not 4
  });

  it('uses dev stage when STAGE env var is not set', async () => {
    delete process.env['STAGE'];
    stubSsm();
    const { generateRtcToken } = loadModule();
    await generateRtcToken('channel', 1, 3600);

    const paramNames = mockSend.mock.calls.map((c) => (c[0] as Record<string, unknown>)['Name']);
    expect(paramNames).toContain('/furcircle/dev/agora/appId');
    expect(paramNames).toContain('/furcircle/dev/agora/appCertificate');
  });
});
