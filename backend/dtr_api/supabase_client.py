import os
import uuid
import logging
from functools import lru_cache
from supabase import create_client, Client

logger = logging.getLogger(__name__)

@lru_cache(maxsize=1)
def _get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY environment variables")
    return create_client(url, key)

def upload_file(file_bytes: bytes, filename: str) -> str:
    """
    Uploads a file to the Supabase 'dtr-attachments' bucket.
    Returns the file path within the bucket.
    """
    client = _get_client()
    bucket_name = "dtr-attachments"
    
    ext = os.path.splitext(filename)[1]
    unique_filename = f"{uuid.uuid4()}{ext}"
    
    try:
        # Supabase storage upload
        response = client.storage.from_(bucket_name).upload(
            path=unique_filename,
            file=file_bytes,
            file_options={"content-type": "application/octet-stream"}
        )
        return unique_filename
    except Exception as e:
        logger.error(f"Supabase upload failed: {e}")
        raise e

def get_signed_url(filepath: str, expires_in: int = 600) -> str:
    """
    Generates a secure, temporary signed URL for a file.
    """
    client = _get_client()
    bucket_name = "dtr-attachments"
    try:
        response = client.storage.from_(bucket_name).create_signed_url(filepath, expires_in)
        if isinstance(response, dict) and 'signedURL' in response:
            return response['signedURL']
        elif hasattr(response, 'get') and response.get('error'):
            raise Exception(response.get('error'))
        elif hasattr(response, 'signed_url'):
            return response.signed_url
        return str(response)
    except Exception as e:
        logger.error(f"Failed to generate signed URL: {e}")
        raise e
