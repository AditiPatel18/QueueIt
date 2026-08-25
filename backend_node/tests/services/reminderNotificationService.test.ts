import { NotificationService } from '../../src/services/notificationService';

jest.mock('nodemailer');

describe('Notification Service Unit Tests', () => {
  it('should return email health status', () => {
    const health = NotificationService.getEmailHealth();
    expect(health.status).toBeDefined();
    expect(health.provider).toBeDefined();
  });

  it('should attempt sending email via NotificationService instance', async () => {
    const service = new NotificationService();
    const [success, info] = await service.sendEmailAsync(
      'user@example.com',
      'Test Subject',
      '<p>Test body</p>',
      'Test text body'
    );

    expect(typeof success).toBe('boolean');
    expect(typeof info).toBe('string');
  });
});
