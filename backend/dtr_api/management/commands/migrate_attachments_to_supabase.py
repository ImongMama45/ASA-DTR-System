import os
import traceback
from django.core.management.base import BaseCommand
from dtr_api.models import Attachment
from dtr_api import drive_client
from dtr_api import supabase_client

class Command(BaseCommand):
    help = 'Migrates existing attachments from Google Drive to Supabase Storage'

    def handle(self, *args, **options):
        from django.db.models import Q
        attachments = Attachment.objects.exclude(drive_file_id__isnull=True).exclude(drive_file_id='').filter(Q(supabase_file_path__isnull=True) | Q(supabase_file_path=''))
        
        success_count = 0
        failure_count = 0
        
        failure_log_file = 'attachment_migration_failures.log'
        
        self.stdout.write(f"Found {attachments.count()} attachments needing migration.")
        
        with open(failure_log_file, 'a') as f_log:
            for att in attachments:
                self.stdout.write(f"Migrating attachment {att.id} ({att.original_filename})...")
                try:
                    # 1. Download from Google Drive
                    content, mime_type = drive_client.download_file(att.drive_file_id)
                    
                    # 2. Upload to Supabase
                    supabase_path = supabase_client.upload_file(content, att.original_filename)
                    
                    # 3. Update the database record
                    att.supabase_file_path = supabase_path
                    att.save(update_fields=['supabase_file_path'])
                    
                    success_count += 1
                    self.stdout.write(self.style.SUCCESS(f"Successfully migrated {att.id} to {supabase_path}"))
                except Exception as e:
                    failure_count += 1
                    error_msg = f"Failed to migrate attachment {att.id}: {str(e)}\n{traceback.format_exc()}\n"
                    self.stdout.write(self.style.ERROR(f"Error migrating {att.id}. See log."))
                    f_log.write(error_msg)
                    
        self.stdout.write(self.style.SUCCESS(f"Finished! Success: {success_count}, Failures: {failure_count}"))
        if failure_count > 0:
            self.stdout.write(self.style.WARNING(f"Check {failure_log_file} for failure details."))
