import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { supabase } from '../config/supabase';
import { openDb, dbGet } from '../utils/schemaFallback';

export class NotificationService {
  private sendgridKey = process.env.SENDGRID_API_KEY || null;
  private twilioSid = process.env.TWILIO_ACCOUNT_SID || null;
  private twilioToken = process.env.TWILIO_AUTH_TOKEN || null;
  private twilioFrom = process.env.TWILIO_SMS_FROM || null;

  static getEmailHealth(): { status: string; provider: string } {
    const resendKey = process.env.RESEND_API_KEY;
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const smtpHost = process.env.SMTP_HOST;

    if (resendKey) {
      return { status: 'configured', provider: 'resend' };
    } else if (sendgridKey) {
      return { status: 'configured', provider: 'sendgrid' };
    } else if (smtpHost) {
      return { status: 'configured', provider: 'smtp' };
    } else {
      return { status: 'unconfigured', provider: 'mock' };
    }
  }

  async sendEmail(
    toEmail: string,
    subject: string,
    htmlContent: string,
    textContent?: string
  ): Promise<[boolean, string]> {
    return this.sendEmailAsync(toEmail, subject, htmlContent, textContent);
  }

  async sendEmailAsync(
    toEmail: string,
    subject: string,
    htmlContent: string,
    textContent?: string
  ): Promise<[boolean, string]> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'QueueIt <onboarding@resend.dev>';
    const defaultText = textContent || 'Please view this email in an HTML-capable email client.';

    // 1. Primary: Resend SDK HTTPS API
    if (resendKey) {
      let resendErr = '';
      try {
        const resend = new Resend(resendKey);
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const { data, error } = await resend.emails.send({
              from: fromEmail,
              to: [toEmail],
              subject: subject,
              html: htmlContent,
              text: defaultText,
            });

            if (!error && data?.id) {
              console.log(`[NotificationService] ✅ Email delivered to ${toEmail} via Resend SDK (ID: ${data.id}, attempt ${attempt})`);
              return [true, ''];
            }

            const errorMsg = error ? (typeof error === 'object' && error !== null ? ((error as any).message || JSON.stringify(error)) : String(error)) : 'Unknown Resend error';
            resendErr = `Resend API error (attempt ${attempt}): ${errorMsg}`;
            console.warn(`[NotificationService] ${resendErr}`);

            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (err: any) {
            resendErr = `Resend exception (attempt ${attempt}): ${err?.message || String(err)}`;
            console.warn(`[NotificationService] ${resendErr}`);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
      } catch (err: any) {
        resendErr = `Resend initialization error: ${err?.message || String(err)}`;
        console.warn(`[NotificationService] ${resendErr}`);
      }

      console.error(`[NotificationService] ❌ Resend dispatch failed for ${toEmail}: ${resendErr}`);

      // Fallback to SMTP if explicitly configured
      if (!process.env.SMTP_HOST) {
        return [false, resendErr];
      }
    }

    // 2. Secondary: SMTP Fallback if configured
    if (process.env.SMTP_HOST) {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
      const smtpUser = process.env.SMTP_EMAIL || process.env.SMTP_USER;
      const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpFrom = process.env.EMAIL_FROM || smtpUser || 'no-reply@queueit.com';

      let lastSmtpErr = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: smtpUser && smtpPassword ? {
              user: smtpUser,
              pass: smtpPassword,
            } : undefined,
          });

          await transporter.sendMail({
            from: smtpFrom,
            to: toEmail,
            subject,
            text: defaultText,
            html: htmlContent,
          });

          console.log(`[NotificationService] ✅ Email delivered to ${toEmail} via SMTP fallback (attempt ${attempt})`);
          return [true, ''];
        } catch (err: any) {
          lastSmtpErr = `SMTP error (attempt ${attempt}): ${err.message || err}`;
          console.warn(`[NotificationService] ${lastSmtpErr}`);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      console.error(`[NotificationService] ❌ SMTP fallback failed for ${toEmail} after 3 attempts: ${lastSmtpErr}`);
      return [false, lastSmtpErr];
    }

    // 3. Unconfigured Provider: Safe mock return in development / testing
    console.warn(`[NotificationService] No configured email provider (RESEND_API_KEY or SMTP_HOST missing). Mock log only — to: ${toEmail}, subject: ${subject}`);
    return [true, ''];
  }

  async sendSmsAsync(phoneNumber: string, body: string): Promise<boolean> {
    if (!phoneNumber) {
      console.warn('[NotificationService] SMS requested but phone number is empty.');
      return false;
    }

    // MSG91
    const msg91AuthKey = process.env.MSG91_AUTH_KEY;
    const msg91TemplateId = process.env.MSG91_TEMPLATE_ID;
    if (msg91AuthKey && msg91TemplateId) {
      try {
        const cleanNumber = phoneNumber.replace('+', '').replace(/\s+/g, '').trim();
        const payload = {
          template_id: msg91TemplateId,
          recipients: [
            {
              mobiles: cleanNumber,
              message: body,
              content: body,
              VAR1: body,
              text: body,
            },
          ],
        };

        const response = await fetch('https://control.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: {
            'authkey': msg91AuthKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log(`[NotificationService] SMS sent via MSG91 to ${phoneNumber}`);
          return true;
        } else {
          const bodyText = await response.text();
          console.error(`[NotificationService] MSG91 SMS failed with status ${response.status}: ${bodyText}`);
          return false;
        }
      } catch (err) {
        console.error('[NotificationService] Failed MSG91 send:', err);
        return false;
      }
    }

    // Twilio
    const twilioSid = process.env.TWILIO_ACCOUNT_SID || this.twilioSid;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN || this.twilioToken;
    const twilioFrom = process.env.TWILIO_SMS_FROM || this.twilioFrom;
    if (twilioSid && twilioToken && twilioFrom) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
        const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', phoneNumber);
        params.append('From', twilioFrom);
        params.append('Body', body);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (response.ok) {
          console.log(`[NotificationService] SMS sent via Twilio to ${phoneNumber}`);
          return true;
        } else {
          const bodyText = await response.text();
          console.error(`[NotificationService] Twilio SMS failed with status ${response.status}: ${bodyText}`);
          return false;
        }
      } catch (err) {
        console.error('[NotificationService] Failed Twilio send:', err);
        return false;
      }
    }

    console.warn(`[NotificationService] No configured SMS provider (Twilio or MSG91) for phone: ${phoneNumber}`);
    return false;
  }

  async getDeliveryPreferences(userId: string): Promise<Record<string, any>> {
    let settings: any = {};
    try {
      const { ReminderService } = require('./reminderService');
      settings = await ReminderService.getSettings(userId);
    } catch (err) {
      console.error('Failed to get settings for preferences:', err);
    }

    let emailAddress = settings.email_address;
    if (!emailAddress || !emailAddress.includes('@')) {
      if (userId.includes('@')) {
        emailAddress = userId;
      } else {
        try {
          const { data } = await supabase.auth.admin.getUserById(userId);
          emailAddress = data?.user?.email || '';
        } catch {
          emailAddress = '';
        }
      }
    }

    let phoneNumber = settings.phone_number || '';
    if (!phoneNumber) {
      try {
        const { data } = await supabase.auth.admin.getUserById(userId);
        phoneNumber = data?.user?.phone || data?.user?.user_metadata?.phone || '';
      } catch {
        // ignore
      }
    }

    return {
      email_enabled: settings.email_reminders !== false,
      sms_enabled: settings.sms_reminders === true,
      browser_notifications: settings.browser_notifications !== false,
      email_address: emailAddress,
      phone_number: phoneNumber,
      snoozed_until: settings.snoozed_until,
      timezone: settings.timezone || 'UTC',
      reminder_time: settings.reminder_time || '09:00',
      enabled: settings.enabled !== false,
    };
  }

  async sendPush(subscriptionInfo: any, title: string, body: string): Promise<boolean> {
    console.log(`[Push Mock] Would send push: "${title}" - "${body}" to info:`, subscriptionInfo);
    // Return false so delivery fallback handles email/SMS normally, but let's check
    return false;
  }

  async dispatchAsync(reminderId: string, userId: string, subject: string, content: string): Promise<[boolean, string]> {
    try {
      const pref = await this.getDeliveryPreferences(userId);
      if (!pref.enabled) {
        console.log(`[NotificationService] Reminders are disabled for user ${userId}`);
        return [false, 'Reminders are disabled for the user'];
      }

      const now = new Date();
      const snoozedUntilStr = pref.snoozed_until;
      if (snoozedUntilStr) {
        try {
          const snoozed = new Date(snoozedUntilStr);
          if (now < snoozed) {
            console.log(`[NotificationService] User ${userId} is snoozed until ${snoozed}`);
            return [false, `User reminders are snoozed until ${snoozed.toISOString()}`];
          }
        } catch {
          // ignore
        }
      }

      const errors: string[] = [];
      let emailOk = true;
      let emailErr = '';

      // Send Email
      if (pref.email_enabled && pref.email_address) {
        let emailAlreadySent = false;
        if (reminderId) {
          try {
            const db = openDb();
            const guardRow = await dbGet<{ delivery_logs?: string }>(
              db,
              'SELECT delivery_logs FROM local_reminder_history WHERE id = ?',
              [reminderId]
            );
            db.close();
            if (guardRow && guardRow.delivery_logs && guardRow.delivery_logs.includes('[Email Sent]')) {
              emailAlreadySent = true;
              console.log(`[NotificationService] Email already sent for reminder ${reminderId} — skipping duplicate delivery.`);
            }
          } catch (guardErr) {
            console.warn(`[NotificationService] Could not check duplicate-send guard for reminder ${reminderId}:`, guardErr);
          }
        }

        if (!emailAlreadySent) {
          try {
            let itemId: string | null = null;
            let itemData: any = null;
            let scheduledTimeStr = pref.reminder_time || '09:00';
            let timezoneStr = pref.timezone || 'UTC';
            let userName = 'Reader';

            if (reminderId) {
              try {
                const db = openDb();
                const remRow = await dbGet<{ item_id?: string; scheduled_time?: string }>(
                  db,
                  'SELECT item_id, scheduled_time FROM local_reminder_history WHERE id = ?',
                  [reminderId]
                );
                db.close();

                if (remRow) {
                  itemId = remRow.item_id || null;
                  if (remRow.scheduled_time) {
                    scheduledTimeStr = remRow.scheduled_time;
                  }

                  if (itemId) {
                    const res = await supabase.from('items').select('*').eq('id', itemId);
                    if (res.data && res.data.length > 0) {
                      itemData = res.data[0];
                      const { fallbackDb } = require('../utils/schemaFallback');
                      itemData = await fallbackDb.mergeSingleItemMetadata(userId, itemData);
                    }
                  }
                }
              } catch (dbErr) {
                console.warn(`[NotificationService] Failed to fetch item details for email design:`, dbErr);
              }
            }

            // Fetch user name
            try {
              const { data } = await supabase.auth.admin.getUserById(userId);
              if (data && data.user) {
                userName = data.user.user_metadata?.name || data.user.user_metadata?.full_name || '';
                if (!userName && data.user.email) {
                  userName = data.user.email.split('@')[0];
                }
              }
            } catch (userErr) {
              console.warn(`[NotificationService] Could not retrieve user details:`, userErr);
              if (userId.includes('@')) {
                userName = userId.split('@')[0];
              }
            }

            // Setup recommendation fields
            const frontendBase = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://queueit-one.vercel.app' : 'http://localhost:3000');
            const dashboardUrl = `${frontendBase.replace(/[-/]+$/, '')}/dashboard`;
            let itemTitle = 'an item from your queue';
            let itemUrl = itemId ? `${dashboardUrl}?item=${itemId}` : dashboardUrl;
            let priorityScore = 50.0;
            let estimatedMinutes = 5.0;
            let aiSummary = '';

            if (itemData) {
              itemTitle = itemData.title || itemTitle;
              itemUrl = (itemData.url && itemData.url.startsWith('http')) 
                ? itemData.url 
                : `${dashboardUrl}?item=${itemData.id}`;
              priorityScore = itemData.priority_score || 50.0;

              const estMin = itemData.estimated_time_minutes;
              if (estMin === undefined || estMin === null) {
                const estSec = itemData.estimated_read_time;
                if (estSec !== undefined && estSec !== null) {
                  estimatedMinutes = parseFloat(estSec) / 60.0;
                } else {
                  estimatedMinutes = 5.0;
                }
              } else {
                estimatedMinutes = parseFloat(estMin);
              }

              aiSummary = itemData.ai_summary || itemData.description || '';
            } else {
              let contentClean = content;
              if (contentClean.startsWith("Time to read: '") && contentClean.endsWith("' (High priority)")) {
                contentClean = contentClean.substring("Time to read: '".length, contentClean.length - "' (High priority)".length);
              }
              itemTitle = contentClean;
            }

            let priorityLabel = 'Normal Priority';
            let priorityColor = '#71717a';
            if (priorityScore >= 75) {
              priorityLabel = 'High Priority';
              priorityColor = '#ef4444';
            } else if (priorityScore >= 40) {
              priorityLabel = 'Medium Priority';
              priorityColor = '#8b5cf6';
            }

            let aiSummaryHtml = '';
            if (aiSummary) {
              aiSummaryHtml = `
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #e2e8f0; margin-top: 14px; padding-top: 14px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Summary</p>
                    <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.6;">
                      ${aiSummary}
                    </p>
                  </td>
                </tr>
              </table>
              `;
            }

            const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QueueIt Daily Reading Reminder</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 100% !important;
      background-color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: #0f172a;
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    @media only screen and (max-width: 600px) {
      .container {
        width: 100% !important;
        padding: 16px !important;
      }
      .content-card {
        padding: 24px 20px !important;
      }
      .cta-button {
        display: block !important;
        width: 100% !important;
        text-align: center !important;
        margin-bottom: 12px !important;
        box-sizing: border-box !important;
      }
      .button-spacing {
        display: none !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <div style="display: none;" id="reminder-item-id" data-item-id="${itemId || ''}">${itemId || ''}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; table-layout: fixed; padding: 40px 0;">
    <tr>
      <td align="center">
        <table class="container" width="580" cellpadding="0" cellspacing="0" border="0" style="width: 580px; max-width: 580px;">
          <!-- QueueIt Header Branding -->
          <tr>
            <td align="left" style="padding-bottom: 24px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <div style="width: 32px; height: 32px; background: #4f46e5; border-radius: 8px; text-align: center; line-height: 32px; color: #ffffff; font-weight: 800; font-size: 18px;">
                      Q
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">QueueIt</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td class="content-card" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);">
              <p style="margin-top: 0; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #64748b;">Hi ${userName},</p>
              <h2 style="margin-top: 0; margin-bottom: 20px; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">Time for your daily reading recommendation</h2>
              
              <!-- Content Item Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 17px; font-weight: 700; color: #0f172a; line-height: 1.4;">
                      ${itemTitle}
                    </h3>
                    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">
                      <tr>
                        <td style="padding-right: 10px; vertical-align: middle;">
                          <span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 4px; color: #ffffff; background-color: ${priorityColor};">
                            ${priorityLabel}
                          </span>
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="font-size: 13px; font-weight: 500; color: #64748b;">
                            ⏱️ ${estimatedMinutes.toFixed(1)} min read
                          </span>
                        </td>
                      </tr>
                    </table>
                    ${aiSummaryHtml}
                  </td>
                </tr>
              </table>
              
              <!-- Action Buttons -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a class="cta-button" href="${itemUrl}" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 11px 22px; border-radius: 8px; text-align: center;">
                      Read Now
                    </a>
                    <span class="button-spacing" style="display: inline-block; width: 10px;"></span>
                    <a class="cta-button" href="${dashboardUrl}" target="_blank" style="display: inline-block; background-color: #ffffff; border: 1px solid #cbd5e1; color: #334155; font-size: 14px; font-weight: 600; text-decoration: none; padding: 11px 22px; border-radius: 8px; text-align: center;">
                      View Queue
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 12px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                Scheduled time: ${scheduledTimeStr} (${timezoneStr})
              </p>
              <p style="margin: 0 0 12px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                You are receiving this email because you enabled reading reminders in QueueIt.
              </p>
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                <a href="${dashboardUrl}" target="_blank" style="color: #4f46e5; text-decoration: underline;">Manage Preferences</a> 
                &nbsp;&bull;&nbsp; 
                <a href="${dashboardUrl}" target="_blank" style="color: #4f46e5; text-decoration: underline;">Unsubscribe</a>
              </p>
              <p style="margin: 16px 0 0 0; font-size: 11px; color: #94a3b8;">
                &copy; 2026 QueueIt. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

            const textBody = `Hello ${userName},

Today's Reading Recommendation:
"${itemTitle}"
Item ID: ${itemId || ''}

Priority: ${priorityLabel}
Estimated Reading Time: ${estimatedMinutes.toFixed(1)} minutes
${aiSummary ? `Summary: ${aiSummary}` : ''}

Open Today's Content: ${itemUrl}
Open QueueIt Dashboard: ${dashboardUrl}

---
Scheduled time: ${scheduledTimeStr} (${timezoneStr})
You are receiving this because you enabled email reminders in your QueueIt settings.
Manage Reminders: ${dashboardUrl}
`;

            const [emailSendOk, emailSendErr] = await this.sendEmailAsync(
              pref.email_address,
              subject,
              htmlBody,
              textBody
            );

            if (emailSendOk) {
              emailErr = '[Email Sent]';
              console.log(`[NotificationService] ✅ Email successfully dispatched for reminder ${reminderId} to ${pref.email_address}`);
            } else {
              emailOk = false;
              emailErr = emailSendErr;
              console.error(`[NotificationService] ❌ Email dispatch failed for reminder ${reminderId}: ${emailErr}`);
            }
          } catch (err: any) {
            emailOk = false;
            emailErr = `Email error: ${err.message || err}`;
            console.error(`[NotificationService] ❌ Unexpected email error for reminder ${reminderId}:`, err);
          }
        }
      }

      if (emailErr && emailErr !== '[Email Sent]') {
        errors.push('Unable to send email reminder.');
      }

      // Send SMS
      let smsOk = true;
      let smsErr = '';
      if (pref.sms_enabled && pref.phone_number) {
        try {
          const smsBody = `QueueIt: ${content}`;
          smsOk = await this.sendSmsAsync(pref.phone_number, smsBody);
          if (!smsOk) {
            smsErr = 'SMS send failed (provider error or timeout)';
          }
        } catch (err: any) {
          smsOk = false;
          smsErr = `SMS error: ${err.message || err}`;
        }
      }

      if (smsErr) {
        errors.push(smsErr);
      }

      // Send Browser/Push Notification
      let pushOk = false;
      let pushAttempted = false;
      let pushErr = '';
      if (pref.browser_notifications) {
        try {
          const subResp = await supabase.from('push_subscriptions').select('subscription').eq('user_id', userId).maybeSingle();
          const subInfo = subResp?.data?.subscription;
          if (subInfo) {
            pushAttempted = true;
            pushOk = await this.sendPush(subInfo, subject, content);
            if (!pushOk) {
              pushErr = 'Push notification delivery returned False';
            }
          } else {
            pushErr = 'No push subscription found';
          }
        } catch (ex: any) {
          pushOk = false;
          pushErr = `Push error: ${ex.message || ex}`;
        }
      }

      if (pushErr && pref.browser_notifications) {
        errors.push(pushErr);
      }

      const emailReq = !!(pref.email_enabled && pref.email_address);
      const smsReq = !!(pref.sms_enabled && pref.phone_number);

      if (pushAttempted && pushOk) {
        const successMsg = (emailReq && emailOk) ? '[Email Sent]' : '';
        return [true, successMsg];
      }

      if (!emailReq && !smsReq) {
        const errMsg = errors.length > 0 ? errors.join('; ') : 'No notification channels enabled or configured';
        return [false, errMsg];
      }

      const overallSuccess = (emailReq ? emailOk : true) && (smsReq ? smsOk : true);
      let errMsg = '';
      if (overallSuccess) {
        errMsg = (emailReq && emailOk) ? '[Email Sent]' : '';
      } else {
        const errComponents: string[] = [];
        if (emailReq && emailOk) {
          errComponents.push('[Email Sent]');
        }
        if (errors.length > 0) {
          errComponents.push(...errors);
        }
        errMsg = errComponents.join(' | ');
      }

      return [overallSuccess, errMsg];
    } catch (err: any) {
      console.error(`Error in async notification dispatch for ${userId}:`, err);
      return [false, 'Unable to send email reminder.'];
    }
  }
}
