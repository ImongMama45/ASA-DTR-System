import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url

# 1. Configure Cloudinary
cloudinary.config( 
  cloud_name = "segk9dlz", 
  api_key = "526571989194152", 
  api_secret = "2Ph9rfGPCygv18VLTwz4eEzAz5E",
  secure = True
)

print("--- Uploading Image ---")
# 2. Upload an image using a sample image from the demo domain
upload_result = cloudinary.uploader.upload("https://res.cloudinary.com/demo/image/upload/sample.jpg")

print(f"Secure URL: {upload_result['secure_url']}")
print(f"Public ID: {upload_result['public_id']}\n")

print("--- Image Details ---")
# 3. Get image details
print(f"Width: {upload_result['width']} px")
print(f"Height: {upload_result['height']} px")
print(f"Format: {upload_result['format']}")
print(f"File Size: {upload_result['bytes']} bytes\n")

print("--- Transforming Image ---")
# 4. Transform the image
# We use f_auto to automatically deliver the best image format for the user's browser (like WebP or AVIF).
# We use q_auto to automatically compress the image to a smaller file size without sacrificing visual quality.
transformed_url, options = cloudinary_url(
    upload_result['public_id'],
    fetch_format="auto",
    quality="auto"
)

print("Done! Click the link below to see the optimized version of the image. Check the size and the format.")
print(transformed_url)
