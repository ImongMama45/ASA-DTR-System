"""
HMAC-based QR payload generation and verification for the Attendance System.

The QR code encodes a JSON payload signed with Django's SECRET_KEY:
    { "eid": employee_id, "cv": card_version, "iat": issued_at_unix, "sig": hmac_signature }

- `eid`  = Employee.pk (immutable)
- `cv`   = Employee.card_version (incremented on reissue, stale versions rejected)
- `iat`  = Unix timestamp when the payload was generated
- `sig`  = HMAC-SHA256 truncated to 16 hex chars (sufficient for tamper detection)

No new Python packages — stdlib only (hmac, hashlib, json, time).
"""
import hmac
import hashlib
import json
import time

from django.conf import settings

QR_SECRET = settings.SECRET_KEY.encode()
QR_EXPIRY_SECONDS = 365 * 24 * 3600  # 1 year — physical cards are long-lived


def generate_qr_payload(employee_id, card_version):
    """Generate an HMAC-signed JSON payload for embedding in a QR code.

    Returns a JSON string suitable for rendering into a QR code.
    """
    issued_at = int(time.time())
    message = f"{employee_id}:{card_version}:{issued_at}"
    sig = hmac.new(QR_SECRET, message.encode(), hashlib.sha256).hexdigest()[:16]
    return json.dumps({
        'eid': employee_id,
        'cv': card_version,
        'iat': issued_at,
        'sig': sig,
    })


def verify_qr_payload(payload_str, expected_card_version):
    """Verify and decode a QR payload.

    Returns (employee_id, None) on success, or (None, error_message) on failure.
    """
    try:
        data = json.loads(payload_str)
    except (json.JSONDecodeError, TypeError):
        return None, "Invalid QR code format."

    eid = data.get('eid')
    cv = data.get('cv')
    iat = data.get('iat')
    sig = data.get('sig')

    if not all([eid is not None, cv is not None, iat is not None, sig]):
        return None, "Incomplete QR data."

    # Verify HMAC signature
    message = f"{eid}:{cv}:{iat}"
    expected_sig = hmac.new(QR_SECRET, message.encode(), hashlib.sha256).hexdigest()[:16]
    if not hmac.compare_digest(str(sig), expected_sig):
        return None, "QR signature invalid — possible forgery."

    # Check card version
    if int(cv) != int(expected_card_version):
        return None, "This ID card has been revoked. A newer version exists."

    # Check expiry
    if time.time() - int(iat) > QR_EXPIRY_SECONDS:
        return None, "This QR code has expired."

    return int(eid), None
