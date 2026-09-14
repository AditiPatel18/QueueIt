const mockSend = jest.fn();

jest.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: (...args: any[]) => mockSend(...args),
      };
    },
  };
});

jest.mock('nodemailer');

import { NotificationService } from '../../src/services/notificationService';

describe('Notification Service Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return email health status as resend when RESEND_API_KEY is present', () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    const health = NotificationService.getEmailHealth();
    expect(health.status).toBe('configured');
    expect(health.provider).toBe('resend');
  });

  it('should attempt sending email via NotificationService instance (mock log fallback)', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const service = new NotificationService();
    const [success, info] = await service.sendEmailAsync(
      'user@example.com',
      'Test Subject',
      '<p>Test body</p>',
      'Test text body'
    );

    expect(success).toBe(true);
    expect(info).toBe('');
  });

  it('should send email successfully using Resend SDK when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    process.env.EMAIL_FROM = 'QueueIt <onboarding@resend.dev>';
    mockSend.mockResolvedValueOnce({
      data: { id: 'msg_resend_12345' },
      error: null,
    });

    const service = new NotificationService();
    const [success, info] = await service.sendEmailAsync(
      'user@example.com',
      'Test Resend Subject',
      '<p>Test Resend Body</p>',
      'Test Resend Text'
    );

    expect(success).toBe(true);
    expect(info).toBe('');
    expect(mockSend).toHaveBeenCalledWith({
      from: 'QueueIt <onboarding@resend.dev>',
      to: ['user@example.com'],
      subject: 'Test Resend Subject',
      html: '<p>Test Resend Body</p>',
      text: 'Test Resend Text',
    });
  });

  it('should handle Resend API failure gracefully and retry without crashing', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    delete process.env.SMTP_HOST;

    mockSend
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid API key' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid API key' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid API key' } });

    const service = new NotificationService();
    const [success, info] = await service.sendEmailAsync(
      'user@example.com',
      'Test Subject',
      '<p>Test Body</p>'
    );

    expect(success).toBe(false);
    expect(info).toContain('Resend API error');
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('should handle Resend unverified domain recipient restriction gracefully without looping', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    delete process.env.SMTP_HOST;

    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'You can only send testing emails to your own email address (test@example.com).' },
    });

    const service = new NotificationService();
    const [success, info] = await service.sendEmailAsync(
      'other_user@example.com',
      'Test Subject',
      '<p>Test Body</p>'
    );

    expect(success).toBe(false);
    expect(info).toContain('[Permanent Restriction]');
    expect(info).toContain('unverified sending domain');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
