"""
Management command: create_superadmin
Usage:
  python manage.py create_superadmin --username admin --password yourpassword

Creates (or updates) a User and assigns it SuperAdmin role via UserProfile.
Safe to re-run — it won't create duplicates.
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from dtr_api.models import UserProfile


class Command(BaseCommand):
    help = 'Create or update a SuperAdmin user with a proper UserProfile and role.'

    def add_arguments(self, parser):
        parser.add_argument('--username', type=str, required=True, help='Username for the admin account')
        parser.add_argument('--password', type=str, required=True, help='Password for the admin account')

    def handle(self, *args, **options):
        username = options['username']
        password = options['password']

        user, created = User.objects.get_or_create(username=username)
        user.set_password(password)
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.save()

        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.role = 'SuperAdmin'
        profile.save()

        action = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(
            f'{action} user "{username}" with role SuperAdmin.'
        ))
