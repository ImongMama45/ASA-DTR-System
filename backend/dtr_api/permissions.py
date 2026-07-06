"""
Custom DRF permission classes for the DTR system RBAC model.

Rule of thumb:
- Safe (read) methods are allowed for any authenticated user.
- Write methods are gated by role.
- SuperAdmin passes every check unconditionally.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


def _role(request):
    """Return the role string from the user's profile, or None if unavailable."""
    try:
        return request.user.profile.role
    except AttributeError:
        return None


class IsAuthenticatedAndActive(BasePermission):
    """Baseline: user must be logged in AND their Django account must be active."""
    message = "Authentication required."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active)


class IsSuperAdmin(BasePermission):
    """Only the SuperAdmin role. Used for destructive operations and user management."""
    message = "Only SuperAdmin can perform this action."

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and _role(request) == 'SuperAdmin'
        )


class CanManageEmployees(BasePermission):
    """
    SuperAdmin, President, Vice President can write employee data.
    All authenticated users can read it.
    Note: destroy() must also check IsSuperAdmin independently in the view.
    """
    message = "Only SuperAdmin, President, or Vice President can edit employee records."
    _WRITE_ROLES = {'SuperAdmin', 'President', 'Vice President'}

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.is_active):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in self._WRITE_ROLES


class CanManageDTR(BasePermission):
    """SuperAdmin, President, Vice President, Secretary can create/update DTR batches."""
    message = "Only SuperAdmin, President, Vice President, or Secretary can manage DTR records."
    _WRITE_ROLES = {'SuperAdmin', 'President', 'Vice President', 'Secretary'}

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.is_active):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in self._WRITE_ROLES


class CanManageFunds(BasePermission):
    """
    SuperAdmin, President, Vice President, Treasurer can write fund payment records.
    All authenticated users can read them (full roster, read-only for Members/Secretary).
    """
    message = "Only SuperAdmin, President, Vice President, or Treasurer can edit fund records."
    _WRITE_ROLES = {'SuperAdmin', 'President', 'Vice President', 'Treasurer'}

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.is_active):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in self._WRITE_ROLES


class CanAccessAttachment(BasePermission):
    """
    Custom permission for uploading and downloading attachments.
    Uploads (POST) check request.data for the target type.
    Downloads (GET) check the attachment object directly.
    """
    message = "You do not have permission to access this attachment."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.is_active):
            return False
            
        # For downloads, we rely on has_object_permission
        if request.method in SAFE_METHODS:
            return True
            
        # For uploads (POST), check the target ID in the request data
        role = _role(request)
        if request.data.get('employee_id'):
            return role in CanManageEmployees._WRITE_ROLES
        elif request.data.get('dtr_batch_id'):
            return role in CanManageDTR._WRITE_ROLES
        elif request.data.get('fund_payment_id'):
            return role in CanManageFunds._WRITE_ROLES
            
        # If no valid target is provided, deny. (The view will also validate this).
        return False

    def has_object_permission(self, request, view, obj):
        role = _role(request)
        
        if obj.employee_id:
            # Upload/View: SuperAdmin, Pres, VP + the employee themselves for viewing
            if role in CanManageEmployees._WRITE_ROLES:
                return True
            # Allow the linked employee to view their own attachment
            if request.method in SAFE_METHODS:
                try:
                    if request.user.profile.employee_id == obj.employee_id:
                        return True
                except AttributeError:
                    pass
            return False
            
        elif obj.dtr_batch_id:
            # Upload/View: SuperAdmin, Pres, VP, Secretary
            return role in CanManageDTR._WRITE_ROLES
            
        elif obj.fund_payment_id:
            # Upload/View: SuperAdmin, Pres, VP, Treasurer
            return role in CanManageFunds._WRITE_ROLES
            
        return False
