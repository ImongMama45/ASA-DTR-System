import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dtr_project.settings')
django.setup()

import cloudinary
import cloudinary.uploader

# Cloudinary requires configuration to be loaded via CLOUDINARY_URL env var
config = cloudinary.config()
print(f"Loaded Cloudinary Config -> Cloud Name: {config.cloud_name}")

if not config.cloud_name:
    print("ERROR: No Cloudinary URL configured in environment.")
    print("Please add CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME to your .env file.")
else:
    # Attempt a simple base64 image upload to verify it works
    test_image_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    try:
        response = cloudinary.uploader.upload(test_image_b64, folder="dtr_test")
        print("SUCCESS! Test upload complete.")
        print(f"Secure URL: {response.get('secure_url')}")
    except Exception as e:
        print(f"UPLOAD FAILED: {e}")
