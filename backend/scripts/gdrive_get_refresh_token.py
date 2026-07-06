"""
Run this ONCE, locally, on a machine with a browser.
Requires: pip install google-auth-oauthlib

Usage:
    python gdrive_get_refresh_token.py /path/to/client_secret_XXXX.json
"""
import sys
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

def main():
    client_secret_path = sys.argv[1]
    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    creds = flow.run_local_server(port=0)
    print("\n--- SAVE THESE AS ENVIRONMENT VARIABLES ON THE SERVER ---")
    print(f"GDRIVE_CLIENT_ID={creds.client_id}")
    print(f"GDRIVE_CLIENT_SECRET={creds.client_secret}")
    print(f"GDRIVE_REFRESH_TOKEN={creds.refresh_token}")
    print("----------------------------------------------------------")
    print("Never commit these or paste them into a chat tool.")

if __name__ == "__main__":
    main()
