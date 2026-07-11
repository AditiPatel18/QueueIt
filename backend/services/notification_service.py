import os
import json
import logging
from datetime import datetime, time
from typing import List, Optional, Dict, Any
import asyncio

from pydantic import BaseModel
from utils.supabase_client import supabase

logger = logging.getLogger(__name__)

class NotificationPreference(BaseModel):
    user_id: str
    email_enabled: bool = True
    push_enabled: bool = True
    whatsapp_enabled: bool = False
    sms_enabled: bool = False
    quiet_start: Optional[time] = None
    quiet_end: Optional[time] = None
    preferred_days: Optional[List[int]] = None  # 0=Mon ... 6=Sun
    preferred_time: Optional[time] = None
    max_items_per_notification: int = 5
    snoozed_until: Optional[datetime] = None

class NotificationRecord(BaseModel):
    id: str
    user_id: str
    channel: str
    content: str
    sent_at: datetime
    read_at: Optional[datetime] = None
    clicked_at: Optional[datetime] = None

class NotificationService:
    def __init__(self):
        self.sendgrid_key = os.getenv("SENDGRID_API_KEY")
        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.vapid_private = os.getenv("VAPID_PRIVATE_KEY")
        self.vapid_public = os.getenv("VAPID_PUBLIC_KEY")
        if not all([self.sendgrid_key, self.twilio_sid, self.twilio_token, self.vapid_private, self.vapid_public]):
            logger.warning("One or more notification service credentials are missing")

    # ---------------------------------------------------------------------
    # Email via SendGrid
    # ---------------------------------------------------------------------
    def send_email(self, to_email: str, subject: str, html_content: str) -> bool:
        try:
            resend_key = os.getenv("RESEND_API_KEY")
            if resend_key:
                import httpx
                headers = {
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "from": os.getenv("EMAIL_FROM", "QueueIt <onboarding@resend.dev>"),
                    "to": [to_email],
                    "subject": subject,
                    "html": html_content
                }
                resp = httpx.post("https://api.resend.com/emails", json=payload, headers=headers, timeout=10.0)
                if resp.status_code in (200, 201):
                    logger.info(f"Email sent via Resend to {to_email}")
                    return True
                else:
                    logger.error(f"Resend email dispatch failed: {resp.text}")
                    return False

            elif self.sendgrid_key:
                import sendgrid
                from sendgrid.helpers.mail import Mail
                sg = sendgrid.SendGridAPIClient(api_key=self.sendgrid_key)
                mail = Mail(
                    from_email=os.getenv("EMAIL_FROM", "no-reply@queueit.com"),
                    to_emails=to_email,
                    subject=subject,
                    html_content=html_content,
                )
                response = sg.send(mail)
                logger.info(f"Email sent to {to_email} via SendGrid, status {response.status_code}")
                return 200 <= response.status_code < 300

            elif os.getenv("SMTP_HOST"):
                import smtplib
                from email.mime.multipart import MIMEMultipart
                from email.mime.text import MIMEText
                
                host = os.getenv("SMTP_HOST")
                port = int(os.getenv("SMTP_PORT", "587"))
                # Support both SMTP_USER and SMTP_EMAIL (used by Gmail/aiosmtplib setup)
                user = os.getenv("SMTP_USER") or os.getenv("SMTP_EMAIL")
                pwd = os.getenv("SMTP_PASSWORD")
                from_email = os.getenv("EMAIL_FROM", "no-reply@queueit.com")
                
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = from_email
                msg["To"] = to_email
                msg.attach(MIMEText(html_content, "html"))
                
                if port == 465:
                    server = smtplib.SMTP_SSL(host, port, timeout=10.0)
                else:
                    server = smtplib.SMTP(host, port, timeout=10.0)
                    server.starttls()
                
                if user and pwd:
                    server.login(user, pwd)
                    
                server.sendmail(from_email, to_email, msg.as_string())
                server.quit()
                logger.info(f"Email sent to {to_email} via SMTP")
                return True

            else:
                logger.info(f"[Email mock log] to: {to_email}, subject: {subject}")
                return True
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    # ---------------------------------------------------------------------
    # SMS / WhatsApp via Twilio
    # ---------------------------------------------------------------------
    def send_twilio(self, to_number: str, body: str, via_whatsapp: bool = False) -> bool:
        try:
            from twilio.rest import Client
            client = Client(self.twilio_sid, self.twilio_token)
            from_number = os.getenv("TWILIO_WHATSAPP_FROM") if via_whatsapp else os.getenv("TWILIO_SMS_FROM")
            message = client.messages.create(body=body, from_=from_number, to=to_number)
            logger.info(f"Twilio message sent to {to_number}, sid {message.sid}")
            return True
        except Exception as e:
            logger.error(f"Failed Twilio send to {to_number}: {e}")
            return False

    # ---------------------------------------------------------------------
    # Web Push via pywebpush
    # ---------------------------------------------------------------------
    def send_push(self, subscription_info: Dict, title: str, body: str, url: Optional[str] = None) -> bool:
        try:
            from pywebpush import webpush, WebPushException
            payload = json.dumps({"title": title, "body": body, "url": url})
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=self.vapid_private,
                vapid_claims={"sub": "mailto:admin@queueit.com"},
            )
            logger.info("Web push notification sent")
            return True
        except WebPushException as we:
            logger.error(f"Web push failed: {we}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error in push: {e}")
            return False

    # ---------------------------------------------------------------------
    # Preference helpers
    # ---------------------------------------------------------------------
    def get_user_preferences(self, user_id: str) -> NotificationPreference:
        try:
            resp = supabase.table("notification_preferences").select("*").eq("user_id", user_id).single().execute()
            data = resp.data or {}
            return NotificationPreference(**data)
        except Exception:
            try:
                from services.reminder_service import ReminderService
                local_set = ReminderService.get_settings(user_id)
                snoozed = None
                if local_set.get("snoozed_until"):
                    try:
                        snoozed = datetime.fromisoformat(local_set["snoozed_until"])
                    except Exception:
                        pass
                return NotificationPreference(
                    user_id=user_id,
                    email_enabled=local_set.get("email_reminders", 1) == 1,
                    push_enabled=local_set.get("browser_notifications", 1) == 1,
                    snoozed_until=snoozed
                )
            except Exception:
                return NotificationPreference(user_id=user_id)

    def record_notification(self, record: NotificationRecord):
        try:
            supabase.table("notification_history").insert(record.dict()).execute()
        except Exception:
            logger.info("Supabase notification_history table is missing; skipped inserting remote record.")

    # ---------------------------------------------------------------------
    # Core dispatch logic
    # ---------------------------------------------------------------------
    def dispatch(self, user_id: str, subject: str, content: str, top_items: List[dict]) -> bool:
        import uuid
        try:
            pref = self.get_user_preferences(user_id)
            now = datetime.utcnow()
            # Quiet hours check
            if pref.quiet_start and pref.quiet_end:
                start = datetime.combine(now.date(), pref.quiet_start)
                end = datetime.combine(now.date(), pref.quiet_end)
                if start <= now <= end:
                    logger.info(f"User {user_id} is within quiet hours – skipping")
                    return False
            # Snoozed check
            if pref.snoozed_until and now < pref.snoozed_until:
                logger.info(f"User {user_id} snoozed until {pref.snoozed_until}")
                return False
            # Day & time preference check
            if pref.preferred_days is not None and now.weekday() not in pref.preferred_days:
                logger.info(f"User {user_id} prefers other days – skipping")
                return False
            if pref.preferred_time is not None:
                preferred_dt = datetime.combine(now.date(), pref.preferred_time)
                # simple tolerance of +/- 1 hour
                if abs((now - preferred_dt).total_seconds()) > 3600:
                    logger.info(f"User {user_id} prefers another time – skipping")
                    return False

            # Build payload (limit items)
            items_html = "".join([f"<li>{i.get('title','')}</li>" for i in top_items[: pref.max_items_per_notification]])
            html_body = f"<h3>{subject}</h3><p>{content}</p><ul>{items_html}</ul>"
            
            success = True
            # Email
            if pref.email_enabled:
                email_ok = self.send_email(to_email=user_id, subject=subject, html_content=html_body)
                if not email_ok:
                    success = False
            # Push
            if pref.push_enabled:
                try:
                    sub_resp = supabase.table("push_subscriptions").select("subscription").eq("user_id", user_id).single().execute()
                    sub_info = sub_resp.data.get("subscription") if sub_resp.data else None
                    if sub_info:
                        push_ok = self.send_push(subscription_info=sub_info, title=subject, body=content, url=None)
                        if not push_ok:
                            success = False
                except Exception:
                    # Non-fatal push check (push subscription table may not exist)
                    pass
            # WhatsApp / SMS
            if pref.whatsapp_enabled:
                self.send_twilio(to_number=user_id, body=content, via_whatsapp=True)
            if pref.sms_enabled:
                self.send_twilio(to_number=user_id, body=content, via_whatsapp=False)
            
            # Record notification history
            try:
                record = NotificationRecord(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    channel="mixed",
                    content=content,
                    sent_at=datetime.utcnow(),
                )
                self.record_notification(record)
            except Exception:
                pass
                
            return success
        except Exception as e:
            logger.error(f"Notification dispatch failed for user {user_id}: {e}")
            return False

    # ---------------------------------------------------------------------
    # Async Delivery, Twilio/MSG91, Resend & SMTP and Queue integrations
    # ---------------------------------------------------------------------
    def get_delivery_preferences(self, user_id: str) -> Dict[str, Any]:
        """Fetch email, SMS, phone preferences for a user, using fallback/login user details as needed."""
        try:
            from services.reminder_service import ReminderService
            settings = ReminderService.get_settings(user_id)
        except Exception as e:
            logger.error(f"Failed to get settings for preferences: {e}")
            settings = {}
            
        email_address = settings.get("email_address")
        if not email_address or "@" not in email_address:
            if "@" in user_id:
                email_address = user_id
            else:
                try:
                    user_info = supabase.auth.admin.get_user_by_id(user_id)
                    email_address = user_info.user.email
                except Exception:
                    email_address = ""
                    
        phone_number = settings.get("phone_number") or ""
        if not phone_number:
            try:
                user_info = supabase.auth.admin.get_user_by_id(user_id)
                phone_number = user_info.user.phone or user_info.user.user_metadata.get("phone") or ""
            except Exception:
                pass
                
        return {
            "email_enabled": settings.get("email_reminders", True),
            "sms_enabled": settings.get("sms_reminders", False),
            "browser_notifications": settings.get("browser_notifications", True),
            "email_address": email_address,
            "phone_number": phone_number,
            "snoozed_until": settings.get("snoozed_until"),
            "timezone": settings.get("timezone", "UTC"),
            "reminder_time": settings.get("reminder_time", "09:00"),
            "enabled": settings.get("enabled", True)
        }

    async def send_email_async(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None) -> tuple[bool, str]:
        """Sends email using Resend HTTP API (preferred) with SMTP fallback."""
        resend_key = os.getenv("RESEND_API_KEY")
        resend_err = ""
        if resend_key:
            try:
                import httpx
                headers = {
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "from": os.getenv("EMAIL_FROM", "QueueIt <onboarding@resend.dev>"),
                    "to": [to_email],
                    "subject": subject,
                    "html": html_content
                }
                if text_content:
                    payload["text"] = text_content
                async with httpx.AsyncClient() as client:
                    resp = await client.post("https://api.resend.com/emails", json=payload, headers=headers, timeout=10.0)
                    if resp.status_code in (200, 201):
                        logger.info(f"Email sent via Resend async to {to_email}")
                        return True, ""
                    else:
                        resend_err = f"Resend API error (status {resp.status_code}): {resp.text}"
                        logger.error(f"Resend email dispatch failed: {resp.text}")
            except Exception as e:
                resend_err = f"Resend exception: {str(e)}"
                logger.error(f"Resend email error, trying SMTP fallback: {e}")
                
        # Gmail SMTP via aiosmtplib — async, retry once on failure
        if os.getenv("SMTP_HOST"):
            smtp_host = os.getenv("SMTP_HOST")
            smtp_port = int(os.getenv("SMTP_PORT", "587"))
            # SMTP_EMAIL is the primary credential key used in .env; fall back to SMTP_USER
            smtp_user = os.getenv("SMTP_EMAIL") or os.getenv("SMTP_USER")
            smtp_password = os.getenv("SMTP_PASSWORD")
            from_email = os.getenv("EMAIL_FROM") or smtp_user or "no-reply@queueit.com"

            last_smtp_err = ""
            for attempt in range(1, 4):  # attempt 1 = initial, attempt 2 & 3 = retries
                try:
                    import aiosmtplib
                    from email.message import EmailMessage

                    msg = EmailMessage()
                    msg["From"] = from_email
                    msg["To"] = to_email
                    msg["Subject"] = subject
                    # Plain-text fallback for non-HTML clients
                    if text_content:
                        msg.set_content(text_content)
                    else:
                        msg.set_content("Please view this email in an HTML-capable email client.")
                    msg.add_alternative(html_content, subtype="html")

                    await aiosmtplib.send(
                        msg,
                        hostname=smtp_host,
                        port=smtp_port,
                        start_tls=True,
                        username=smtp_user,
                        password=smtp_password,
                    )
                    logger.info(
                        f"[ReminderEmail] ✅ Email delivered to {to_email} "
                        f"via Gmail SMTP (attempt {attempt})"
                    )
                    return True, ""
                except Exception as smtp_err:
                    last_smtp_err = f"Gmail SMTP error (attempt {attempt}): {smtp_err}"
                    logger.warning(f"[ReminderEmail] {last_smtp_err}")
                    if attempt < 3:
                        await asyncio.sleep(1)  # brief pause before retry

            # All 3 attempts exhausted
            final_reason = last_smtp_err
            if resend_err:
                final_reason = f"{resend_err} | {last_smtp_err}"
            logger.error(
                f"[ReminderEmail] ❌ Gmail SMTP failed for {to_email} "
                f"after 3 attempts: {last_smtp_err}"
            )
            return False, final_reason

        # No email provider configured — log mock and return
        if resend_key:
            return False, resend_err

        logger.warning(
            f"[ReminderEmail] No configured email provider. "
            f"Mock log only — to: {to_email}, subject: {subject}"
        )
        return True, ""

    @classmethod
    def get_email_health(cls) -> Dict[str, Any]:
        """Check if email provider is configured and return status."""
        resend_key = os.getenv("RESEND_API_KEY")
        sendgrid_key = os.getenv("SENDGRID_API_KEY")
        smtp_host = os.getenv("SMTP_HOST")
        
        if resend_key:
            return {"status": "configured", "provider": "resend"}
        elif sendgrid_key:
            return {"status": "configured", "provider": "sendgrid"}
        elif smtp_host:
            return {"status": "configured", "provider": "smtp"}
        else:
            return {"status": "unconfigured", "provider": "mock"}

    async def send_sms_async(self, phone_number: str, body: str) -> bool:
        """Sends SMS via Twilio or MSG91 using direct HTTP requests, whichever is configured."""
        if not phone_number:
            logger.warning("SMS requested but phone number is empty.")
            return False

        # MSG91 gateway check
        msg91_authkey = os.getenv("MSG91_AUTH_KEY")
        msg91_template_id = os.getenv("MSG91_TEMPLATE_ID")
        if msg91_authkey and msg91_template_id:
            try:
                import httpx
                clean_number = phone_number.replace("+", "").replace(" ", "").strip()
                url = "https://control.msg91.com/api/v5/flow/"
                headers = {
                    "authkey": msg91_authkey,
                    "content-type": "application/json"
                }
                payload = {
                    "template_id": msg91_template_id,
                    "recipients": [
                        {
                            "mobiles": clean_number,
                            "message": body,
                            "content": body,
                            "VAR1": body,
                            "text": body
                        }
                    ]
                }
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                    if resp.status_code in (200, 201):
                        logger.info(f"SMS sent via MSG91 to {phone_number}")
                        return True
                    else:
                        logger.error(f"MSG91 SMS failed with status {resp.status_code}: {resp.text}")
                        return False
            except Exception as e:
                logger.error(f"Failed MSG91 send: {e}")
                return False

        # Twilio gateway check
        twilio_sid = os.getenv("TWILIO_ACCOUNT_SID") or self.twilio_sid
        twilio_token = os.getenv("TWILIO_AUTH_TOKEN") or self.twilio_token
        twilio_from = os.getenv("TWILIO_SMS_FROM")
        if twilio_sid and twilio_token and twilio_from:
            try:
                import httpx
                url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
                auth = (twilio_sid, twilio_token)
                data = {
                    "To": phone_number,
                    "From": twilio_from,
                    "Body": body
                }
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, auth=auth, data=data, timeout=10.0)
                    if resp.status_code in (200, 201):
                        logger.info(f"SMS sent via Twilio to {phone_number}")
                        return True
                    else:
                        logger.error(f"Twilio SMS failed with status {resp.status_code}: {resp.text}")
                        return False
            except Exception as e:
                logger.error(f"Failed Twilio send: {e}")
                return False

        logger.warning(f"No configured SMS provider (Twilio or MSG91) for phone: {phone_number}")
        return False

    async def dispatch_async(self, reminder_id: str, user_id: str, subject: str, content: str) -> tuple[bool, str]:
        """Asynchronously dispatches reminder notifications based on user preferences."""
        try:
            pref = self.get_delivery_preferences(user_id)
            if not pref.get("enabled"):
                logger.info(f"Reminders are disabled for user {user_id}")
                return False, "Reminders are disabled for the user"
                
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            snoozed_until_str = pref.get("snoozed_until")
            if snoozed_until_str:
                try:
                    snoozed = datetime.fromisoformat(snoozed_until_str)
                    if snoozed.tzinfo is None:
                        snoozed = snoozed.replace(tzinfo=timezone.utc)
                    if now < snoozed:
                        logger.info(f"User {user_id} is snoozed until {snoozed}")
                        return False, f"User reminders are snoozed until {snoozed.isoformat()}"
                except Exception:
                    pass

            errors = []
            email_ok = True
            email_err = ""

            # Send Email — exactly once per reminder (guard against duplicate sends on retry)
            if pref.get("email_enabled") and pref.get("email_address"):
                # Check whether an email was already dispatched for this reminder_id
                email_already_sent = False
                if reminder_id:
                    try:
                        import sqlite3 as _sqlite3
                        from utils.schema_fallback import DB_PATH as _DB_PATH
                        _guard_conn = _sqlite3.connect(_DB_PATH)
                        _guard_cursor = _guard_conn.cursor()
                        _guard_cursor.execute(
                            "SELECT delivery_logs FROM local_reminder_history WHERE id = ?",
                            (reminder_id,)
                        )
                        _guard_row = _guard_cursor.fetchone()
                        _guard_conn.close()
                        if _guard_row and _guard_row[0] and "[Email Sent]" in _guard_row[0]:
                            email_already_sent = True
                            logger.info(
                                f"[ReminderEmail] ℹ️  Email already sent for reminder "
                                f"{reminder_id} — skipping duplicate delivery."
                            )
                    except Exception as _guard_err:
                        logger.warning(
                            f"[ReminderEmail] Could not check duplicate-send guard "
                            f"for reminder {reminder_id}: {_guard_err}"
                        )

                if not email_already_sent:
                    try:
                        # Fetch item details and user settings for email template customization
                        item_id = None
                        item_data = None
                        scheduled_time_str = pref.get("reminder_time") or "09:00"
                        timezone_str = pref.get("timezone") or "UTC"
                        user_name = "Reader"

                        if reminder_id:
                            try:
                                import sqlite3 as _sqlite3
                                from utils.schema_fallback import DB_PATH as _DB_PATH, fallback_db as _fallback_db
                                _conn = _sqlite3.connect(_DB_PATH)
                                _conn.row_factory = _sqlite3.Row
                                _cursor = _conn.cursor()
                                _cursor.execute(
                                    "SELECT item_id, scheduled_time FROM local_reminder_history WHERE id = ?",
                                    (reminder_id,)
                                )
                                _rem_row = _cursor.fetchone()
                                _conn.close()

                                if _rem_row:
                                    _rem_dict = dict(_rem_row)
                                    item_id = _rem_dict.get("item_id")
                                    if _rem_dict.get("scheduled_time"):
                                        scheduled_time_str = _rem_dict.get("scheduled_time")
                                    
                                    if item_id:
                                        _res = supabase.table("items").select("*").eq("id", item_id).execute()
                                        if _res.data:
                                            item_data = _res.data[0]
                                            item_data = _fallback_db.merge_single_item_metadata(user_id, item_data)
                            except Exception as _db_err:
                                logger.warning(f"[ReminderEmail] Failed to fetch item details for email design: {_db_err}")

                        # Fetch user name
                        try:
                            user_info = supabase.auth.admin.get_user_by_id(user_id)
                            if user_info and user_info.user:
                                user_name = (
                                    user_info.user.user_metadata.get("name") 
                                    or user_info.user.user_metadata.get("full_name")
                                )
                                if not user_name:
                                    _email = user_info.user.email
                                    if _email:
                                        user_name = _email.split("@")[0]
                        except Exception as _user_err:
                            logger.warning(f"[ReminderEmail] Could not retrieve user details: {_user_err}")
                            if "@" in user_id:
                                user_name = user_id.split("@")[0]

                        # Setup recommendation fields
                        dashboard_url = os.getenv("FRONTEND_URL", "http://localhost:3000") + "/dashboard"
                        item_title = "an item from your queue"
                        item_url = f"{dashboard_url}?item={item_id}" if item_id else dashboard_url
                        priority_score = 50.0
                        estimated_minutes = 5.0
                        ai_summary = ""

                        if item_data:
                            item_title = item_data.get("title") or item_title
                            item_url = f"{dashboard_url}?item={item_data.get('id')}"
                            priority_score = item_data.get("priority_score") or 50.0
                            
                            est_min = item_data.get("estimated_time_minutes")
                            if est_min is None:
                                est_sec = item_data.get("estimated_read_time")
                                if est_sec is not None:
                                    estimated_minutes = float(est_sec) / 60.0
                                else:
                                    estimated_minutes = 5.0
                            else:
                                estimated_minutes = float(est_min)
                            
                            ai_summary = item_data.get("ai_summary") or item_data.get("description") or ""
                        else:
                            content_clean = content
                            if content_clean.startswith("Time to read: '") and content_clean.endswith("' (High priority)"):
                                content_clean = content_clean[len("Time to read: '"):-len("' (High priority)")]
                            item_title = content_clean

                        # Set priority levels
                        if priority_score >= 75:
                            priority_label = "High Priority"
                            priority_color = "#ef4444"
                        elif priority_score >= 40:
                            priority_label = "Medium Priority"
                            priority_color = "#8b5cf6"
                        else:
                            priority_label = "Normal Priority"
                            priority_color = "#71717a"

                        # Conditional AI Summary HTML block
                        ai_summary_html = ""
                        if ai_summary:
                            ai_summary_html = f"""
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #27272a; margin-top: 16px; padding-top: 16px;">
                              <tr>
                                <td>
                                  <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px;">AI Summary</p>
                                  <p style="margin: 0; font-size: 13px; color: #d4d4d8; line-height: 1.6;">
                                    {ai_summary}
                                  </p>
                                </td>
                              </tr>
                            </table>
                            """

                        dashboard_url = os.getenv("FRONTEND_URL", "http://localhost:3000") + "/dashboard"

                        # Premium responsive HTML body template matching QueueIt theme
                        html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Today's Reading Recommendation</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      width: 100% !important;
      background-color: #09090b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: #f4f4f5;
    }}
    table {{
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }}
    @media only screen and (max-width: 600px) {{
      .container {{
        width: 100% !important;
        padding: 10px !important;
      }}
      .content-card {{
        padding: 24px 16px !important;
      }}
      .cta-button {{
        display: block !important;
        width: auto !important;
        text-align: center !important;
        margin-bottom: 12px !important;
      }}
      .button-spacing {{
        display: none !important;
      }}
    }}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <!-- item_id: {item_id} -->
  <div style="display: none;" id="reminder-item-id" data-item-id="{item_id}">{item_id}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #09090b; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 600px;">
          <tr>
            <td align="center" style="padding: 20px 0 30px 0;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); border-radius: 8px; text-align: center; line-height: 32px; color: #ffffff; font-weight: bold; font-size: 18px;">
                      Q
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">QueueIt</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="content-card" style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
              <p style="margin-top: 0; margin-bottom: 8px; font-size: 15px; color: #a1a1aa; line-height: 1.5;">Hi {user_name},</p>
              <h2 style="margin-top: 0; margin-bottom: 24px; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3;">Today's Reading Recommendation</h2>
              
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin-top: 0; margin-bottom: 12px; font-size: 18px; font-weight: 700; color: #ffffff; line-height: 1.4;">
                      {item_title}
                    </p>
                    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 4px;">
                      <tr>
                        <td style="padding-right: 12px; vertical-align: middle;">
                          <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 6px; color: #ffffff; background-color: {priority_color};">
                            {priority_label}
                          </span>
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="font-size: 13px; color: #a1a1aa;">
                            ⏱️ {estimated_minutes:.1f}m read
                          </span>
                        </td>
                      </tr>
                    </table>
                    {ai_summary_html}
                  </td>
                </tr>
              </table>
              
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a class="cta-button" href="{item_url}" target="_blank" style="display: inline-block; background-color: #6366f1; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 10px; box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.4);">
                      Open Today's Content
                    </a>
                    <span class="button-spacing" style="display: inline-block; width: 12px;"></span>
                    <a class="cta-button" href="{dashboard_url}" target="_blank" style="display: inline-block; background-color: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 10px;">
                      Open QueueIt
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 24px 20px 24px; text-align: center;">
              <p style="margin: 0 0 12px 0; font-size: 12px; color: #71717a; line-height: 1.6;">
                Scheduled time: {scheduled_time_str} ({timezone_str})
              </p>
              <p style="margin: 0 0 12px 0; font-size: 12px; color: #71717a; line-height: 1.6;">
                You are receiving this because you enabled email reminders in your QueueIt preferences.
              </p>
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                <a href="{dashboard_url}" target="_blank" style="color: #6366f1; text-decoration: underline;">Manage Reminders</a> 
                &nbsp;&bull;&nbsp; 
                <a href="{dashboard_url}" target="_blank" style="color: #6366f1; text-decoration: underline;">Unsubscribe</a>
              </p>
              <p style="margin: 24px 0 0 0; font-size: 11px; color: #52525b;">
                &copy; 2026 QueueIt. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

                        # Plain text fallback
                        text_body = f"""Hello {user_name},

Today's Reading Recommendation:
"{item_title}"
Item ID: {item_id or ''}

Priority: {priority_label}
Estimated Reading Time: {estimated_minutes:.1f} minutes
{f'Summary: {ai_summary}' if ai_summary else ''}

Open Today's Content: {item_url}
Open QueueIt Dashboard: {dashboard_url}

---
Scheduled time: {scheduled_time_str} ({timezone_str})
You are receiving this because you enabled email reminders in your QueueIt settings.
Manage Reminders: {dashboard_url}
"""

                        email_ok, email_err = await self.send_email_async(
                            pref["email_address"], subject, html_body, text_body
                        )
                        if email_ok:
                            # Append sentinel so retry runs skip a second email send
                            email_err = "[Email Sent]"
                            logger.info(
                                f"[ReminderEmail] ✅ Email successfully dispatched for reminder "
                                f"{reminder_id} to {pref['email_address']}"
                            )
                        else:
                            logger.error(
                                f"[ReminderEmail] ❌ Email dispatch failed for reminder "
                                f"{reminder_id}: {email_err}"
                            )
                    except Exception as e:
                        email_ok = False
                        email_err = f"Email error: {str(e)}"
                        logger.error(
                            f"[ReminderEmail] ❌ Unexpected email error for reminder "
                            f"{reminder_id}: {e}"
                        )

            # Collect non-sentinel errors for upstream reporting
            if email_err and email_err != "[Email Sent]":
                errors.append(email_err)
                
            # Send SMS
            sms_ok = True
            sms_err = ""
            if pref.get("sms_enabled") and pref.get("phone_number"):
                try:
                    sms_body = f"QueueIt: {content}"
                    sms_ok = await self.send_sms_async(pref["phone_number"], sms_body)
                    if not sms_ok:
                        sms_err = "SMS send failed (provider error or timeout)"
                except Exception as e:
                    sms_ok = False
                    sms_err = f"SMS error: {str(e)}"
            
            if sms_err:
                errors.append(sms_err)
                
            # Send Browser/Push Notification
            push_ok = False
            push_attempted = False
            push_err = ""
            if pref.get("browser_notifications"):
                try:
                    sub_resp = supabase.table("push_subscriptions").select("subscription").eq("user_id", user_id).single().execute()
                    sub_info = sub_resp.data.get("subscription") if sub_resp.data else None
                    if sub_info:
                        push_attempted = True
                        push_ok = await asyncio.to_thread(self.send_push, sub_info, subject, content)
                        if not push_ok:
                            push_err = "Push notification delivery returned False"
                    else:
                        push_err = "No push subscription found"
                except Exception as ex:
                    push_ok = False
                    push_err = f"Push error: {str(ex)}"

            if push_err and pref.get("browser_notifications"):
                errors.append(push_err)

            # Browser notification is primary: if push notification was successfully dispatched, return True immediately
            if push_attempted and push_ok:
                success_msg = "[Email Sent]" if (email_req and email_ok) else ""
                return True, success_msg

            # If browser notifications are not enabled or dispatch was unsuccessful, check other enabled channels
            email_req = pref.get("email_enabled") and pref.get("email_address")
            sms_req = pref.get("sms_enabled") and pref.get("phone_number")
            
            if not email_req and not sms_req:
                err_msg = "; ".join(errors) if errors else "No notification channels enabled or configured"
                return False, err_msg
                
            overall_success = (email_ok if email_req else True) and (sms_ok if sms_req else True)
            if overall_success:
                err_msg = "[Email Sent]" if (email_req and email_ok) else ""
            else:
                err_components = []
                if email_req and email_ok:
                    err_components.append("[Email Sent]")
                if errors:
                    err_components.extend(errors)
                err_msg = " | ".join(err_components)
            return overall_success, err_msg
        except Exception as e:
            logger.error(f"Error in async notification dispatch for {user_id}: {e}", exc_info=True)
            return False, f"Unexpected dispatch exception: {str(e)}"
