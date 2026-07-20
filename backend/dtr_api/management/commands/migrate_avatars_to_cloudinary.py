import os
import json
import traceback
from django.core.management.base import BaseCommand
from dtr_api.models import UserProfile
import cloudinary
import cloudinary.uploader

class Command(BaseCommand):
    help = 'Migrates existing Base64 profile pictures to Cloudinary'

    def handle(self, *args, **options):
        # We assume settings are already configured for Cloudinary via the main app
        profiles = UserProfile.objects.exclude(profile_pic__isnull=True).exclude(profile_pic__exact='')
        
        success_count = 0
        failure_count = 0
        skipped_count = 0
        
        failure_log_file = 'avatar_migration_failures.log'
        
        self.stdout.write(f"Found {profiles.count()} total profiles with a picture set.")
        
        with open(failure_log_file, 'a') as f_log:
            for profile in profiles:
                if profile.profile_pic.startswith('http'):
                    # Already a URL (probably Cloudinary)
                    skipped_count += 1
                    continue
                    
                if profile.profile_pic.startswith('data:image'):
                    self.stdout.write(f"Migrating avatar for {profile.user.username}...")
                    try:
                        # Cloudinary can directly upload a base64 string
                        response = cloudinary.uploader.upload(profile.profile_pic, folder="dtr_avatars")
                        profile.profile_pic = response.get('secure_url')
                        profile.save(update_fields=['profile_pic'])
                        success_count += 1
                        self.stdout.write(self.style.SUCCESS(f"Successfully migrated {profile.user.username} to {profile.profile_pic}"))
                    except Exception as e:
                        failure_count += 1
                        error_msg = f"Failed to migrate {profile.user.username} (ID: {profile.id}): {str(e)}\n{traceback.format_exc()}\n"
                        self.stdout.write(self.style.ERROR(f"Error migrating {profile.user.username}. See log."))
                        f_log.write(error_msg)
                else:
                    # Not standard base64 and not http, log it
                    failure_count += 1
                    msg = f"Skipping {profile.user.username} (ID: {profile.id}): Unknown format (starts with {profile.profile_pic[:15]})\n"
                    self.stdout.write(self.style.WARNING(msg))
                    f_log.write(msg)
                    
        self.stdout.write(self.style.SUCCESS(f"Finished! Success: {success_count}, Skipped (Already URL): {skipped_count}, Failures: {failure_count}"))
        if failure_count > 0:
            self.stdout.write(self.style.WARNING(f"Check {failure_log_file} for failure details."))
