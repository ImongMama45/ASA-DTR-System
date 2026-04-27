from django.db import models
import json


class Employee(models.Model):
    DUTY_CHOICES = [('AM', 'AM Duty'), ('PM', 'PM Duty')]
    name = models.CharField(max_length=200)
    duty = models.CharField(max_length=2, choices=DUTY_CHOICES, default='AM')
    start_date = models.DateField(null=True, blank=True)
    local_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class DTRBatch(models.Model):
    label = models.CharField(max_length=100)
    month = models.IntegerField()
    year = models.IntegerField()
    cutoff = models.IntegerField()
    employees_data = models.TextField(default='[]')
    local_id = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def get_employees(self):
        return json.loads(self.employees_data)

    def set_employees(self, data):
        self.employees_data = json.dumps(data)

    def __str__(self):
        return self.label


class SyncLog(models.Model):
    action = models.CharField(max_length=100)
    payload = models.TextField()
    processed_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=True)

    class Meta:
        ordering = ['-processed_at']
