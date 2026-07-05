from django.apps import AppConfig


class DtrApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'dtr_api'

    def ready(self):
        # Register signals so UserProfile is auto-created for every new User
        import dtr_api.signals  # noqa: F401
