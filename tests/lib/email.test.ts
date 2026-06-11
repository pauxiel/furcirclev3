/**
 * Unit tests for src/lib/email.ts
 */

describe('email.sendEmail', () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockSend = jest.fn().mockResolvedValue({ MessageId: 'msg-1' });
    process.env['FROM_EMAIL'] = 'no-reply@furcircle.app';
  });

  afterEach(() => {
    delete process.env['FROM_EMAIL'];
  });

  const loadModule = () => {
    jest.doMock('@aws-sdk/client-sesv2', () => ({
      SESv2Client: jest.fn(() => ({ send: mockSend })),
      SendEmailCommand: jest.fn((input: unknown) => input),
    }));
    return require('../../src/lib/email') as {
      sendEmail: (m: { to: string; subject: string; html: string; text: string }) => Promise<void>;
    };
  };

  it('sends an email with from, to, subject and both bodies', async () => {
    const { sendEmail } = loadModule();

    await sendEmail({
      to: 'vet@example.com',
      subject: 'New intake',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.FromEmailAddress).toBe('no-reply@furcircle.app');
    expect(cmd.Destination.ToAddresses).toEqual(['vet@example.com']);
    expect(cmd.Content.Simple.Subject.Data).toBe('New intake');
    expect(cmd.Content.Simple.Body.Html.Data).toBe('<p>Hello</p>');
    expect(cmd.Content.Simple.Body.Text.Data).toBe('Hello');
  });

  it('throws when FROM_EMAIL is not configured', async () => {
    delete process.env['FROM_EMAIL'];
    const { sendEmail } = loadModule();

    await expect(
      sendEmail({ to: 'vet@example.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('FROM_EMAIL');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('propagates SES send failures', async () => {
    mockSend.mockRejectedValueOnce(new Error('SES throttled'));
    const { sendEmail } = loadModule();

    await expect(
      sendEmail({ to: 'vet@example.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('SES throttled');
  });
});
