import os
import django
from io import BytesIO

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

from dtr_api.supabase_client import upload_file, get_signed_url, _get_client

print("--- Testing Supabase Client ---")
try:
    _get_client()
except Exception as e:
    print(f"FAILED TO INIT CLIENT: {e}")
    print("Please provide SUPABASE_URL and SUPABASE_KEY in your .env file.")
    exit(1)

test_content = b"This is a test file for Supabase."
test_filename = "test_upload.txt"

print("Uploading test file...")
try:
    path = upload_file(test_content, test_filename)
    print(f"Upload successful! Path: {path}")
    
    print("Fetching signed URL...")
    url = get_signed_url(path, expires_in=600)
    print(f"Signed URL: {url}")
except Exception as e:
    print(f"TEST FAILED: {e}")
