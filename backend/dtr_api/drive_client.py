import os
import io
import logging
from functools import lru_cache

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def _get_credentials():
    return Credentials(
        token=None,
        refresh_token=os.environ["GDRIVE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GDRIVE_CLIENT_ID"],
        client_secret=os.environ["GDRIVE_CLIENT_SECRET"],
        scopes=SCOPES,
    )


@lru_cache(maxsize=1)
def _get_service():
    creds = _get_credentials()
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def upload_file(file_obj, filename: str, mime_type: str) -> str:
    """
    Uploads a file-like object to the configured root Drive folder.
    Returns the new Drive file ID.
    Raises googleapiclient.errors.HttpError on failure -- caller must handle.
    """
    service = _get_service()
    folder_id = os.environ["GDRIVE_ROOT_FOLDER_ID"]
    media = MediaIoBaseUpload(file_obj, mimetype=mime_type, resumable=True)
    metadata = {"name": filename, "parents": [folder_id]}
    result = service.files().create(
        body=metadata, media_body=media, fields="id"
    ).execute()
    return result["id"]


def download_file(drive_file_id: str):
    """
    Downloads a file's bytes and mime type from Drive by ID.
    Returns (bytes, mime_type).
    Raises googleapiclient.errors.HttpError (e.g. 404) on failure -- caller must handle.
    """
    service = _get_service()
    meta = service.files().get(fileId=drive_file_id, fields="mimeType,name").execute()
    request = service.files().get_media(fileId=drive_file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), meta["mimeType"]


def delete_file(drive_file_id: str) -> None:
    service = _get_service()
    service.files().delete(fileId=drive_file_id).execute()
