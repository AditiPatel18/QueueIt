import os
import json
import logging
from datetime import datetime, time
from typing import List, Optional, Dict

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
            import sendgrid
            from sendgrid.helpers.mail import Mail
            sg = sendgrid.SendGridAPIClient(api_key=self.sendgrid_key)
            mail = Mail(
                from_email="no-reply@queueit.com",
                to_emails=to_email,
                subject=subject,
                html_content=html_content,
            )
            response = sg.send(mail)
            logger.info(f"Email sent to {to_email}, status {response.status_code}")
            return 200 <= response.status_code < 300
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
        resp = supabase.table("notification_preferences").select("*").eq("user_id", user_id).single().execute()
        data = resp.data or {}
        return NotificationPreference(**data)

    def record_notification(self, record: NotificationRecord):
        supabase.table("notification_history").insert(record.dict()).execute()

    # ---------------------------------------------------------------------
    # Core dispatch logic
    # ---------------------------------------------------------------------
    def dispatch(self, user_id: str, subject: str, content: str, top_items: List[dict]):
        pref = self.get_user_preferences(user_id)
        now = datetime.utcnow()
        # Quiet hours check
        if pref.quiet_start and pref.quiet_end:
            start = datetime.combine(now.date(), pref.quiet_start)
            end = datetime.combine(now.date(), pref.quiet_end)
            if start <= now <= end:
                logger.info(f"User {user_id} is within quiet hours – skipping")
                return
        # Snoozed check
        if pref.snoozed_until and now < pref.snoozed_until:
            logger.info(f"User {user_id} snoozed until {pref.snoozed_until}")
            return
        # Day & time preference check
        if pref.preferred_days is not None and now.weekday() not in pref.preferred_days:
            logger.info(f"User {user_id} prefers other days – skipping")
            return
        if pref.preferred_time is not None:
            preferred_dt = datetime.combine(now.date(), pref.preferred_time)
            # simple tolerance of +/- 1 hour
            if abs((now - preferred_dt).total_seconds()) > 3600:
                logger.info(f"User {user_id} prefers another time – skipping")
                return
        # Build payload (limit items)
        items_html = "".join([f"<li>{i.get('title','')}</li>" for i in top_items[: pref.max_items_per_notification]])
        html_body = f"<h3>{subject}</h3><p>{content}</p><ul>{items_html}</ul>"
        # Email
        if pref.email_enabled:
            self.send_email(to_email=user_id, subject=subject, html_content=html_body)
        # Push (example – subscription stored in push_subscriptions table)
        if pref.push_enabled:
            sub_resp = supabase.table("push_subscriptions").select("subscription").eq("user_id", user_id).single().execute()
            sub_info = sub_resp.data.get("subscription") if sub_resp.data else None
            if sub_info:
                self.send_push(subscription_info=sub_info, title=subject, body=content, url=None)
        # WhatsApp / SMS
        if pref.whatsapp_enabled:
            self.send_twilio(to_number=user_id, body=content, via_whatsapp=True)
        if pref.sms_enabled:
            self.send_twilio(to_number=user_id, body=content, via_whatsapp=False)
        # Record notification history (simple example)
        record = NotificationRecord(
            id=str(uuid.uuid4()),
            user_id=user_id,
            channel="mixed",
            content=content,
            sent_at=datetime.utcnow(),
        )
        self.record_notification(record)
