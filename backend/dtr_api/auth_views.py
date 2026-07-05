from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate

from .models import UserProfile, Employee


# ─── Custom throttle for login endpoint ────────────────────────────────────────
class LoginThrottle(ScopedRateThrottle):
    scope = 'login'


# ─── Helpers ───────────────────────────────────────────────────────────────────
def _profile_data(user):
    """Return a safe, serializable dict of the user's profile for the /me endpoint."""
    try:
        profile = user.profile
        emp = profile.employee
        return {
            'id': user.id,
            'username': user.username,
            'role': profile.role,
            'employee_id': emp.id if emp else None,
            'employee_name': emp.name if emp else user.username,
            'has_usable_password': user.has_usable_password(),
        }
    except UserProfile.DoesNotExist:
        return {
            'id': user.id,
            'username': user.username,
            'role': 'Member',
            'employee_id': None,
            'employee_name': user.username,
            'has_usable_password': user.has_usable_password(),
        }


# ─── POST /api/auth/login/ ─────────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_view(request):
    """
    Accepts { username, password }.
    Returns { access, refresh, user: {...profile_data} }.
    No registration — accounts are created by SuperAdmin only.
    """
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')

    if not username or not password:
        return Response(
            {'error': 'Username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, username=username, password=password)

    if user is None:
        # Don't reveal whether the username exists or the password was wrong.
        return Response(
            {'error': 'Invalid credentials. Please check your username and password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not user.is_active:
        return Response(
            {'error': 'Your account has been deactivated. Please contact the administrator.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not user.has_usable_password():
        # Account exists but SuperAdmin hasn't set a password yet.
        return Response(
            {'error': 'Your account has no password set yet. Please ask the administrator to set your password.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    refresh = RefreshToken.for_user(user)
    return Response({
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'user': _profile_data(user),
    })


# ─── POST /api/auth/token/refresh/ ────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def token_refresh_view(request):
    """
    Accepts { refresh }.
    Returns { access, refresh } (new pair due to ROTATE_REFRESH_TOKENS=True).
    The old refresh token is blacklisted immediately.
    """
    from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
    refresh_token = request.data.get('refresh')
    if not refresh_token:
        return Response({'error': 'Refresh token is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        token = RefreshToken(refresh_token)
        access = str(token.access_token)
        # Rotation: issue new refresh and blacklist old one
        token.blacklist()
        new_refresh = RefreshToken.for_user(User.objects.get(id=token['user_id']))
        return Response({'access': str(new_refresh.access_token), 'refresh': str(new_refresh)})
    except (TokenError, InvalidToken) as e:
        return Response({'error': 'Invalid or expired refresh token. Please log in again.'}, status=status.HTTP_401_UNAUTHORIZED)


# ─── GET /api/auth/me/ ────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """Returns the currently authenticated user's profile data."""
    return Response(_profile_data(request.user))


# ─── PATCH /api/auth/change-password/ ────────────────────────────────────────
@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """
    Allows a logged-in user to change their own password.
    - If account has an existing usable password: requires old_password.
    - If account was just set up (no usable password yet): skips the old_password check.
    Expects { old_password (optional), new_password }.
    """
    user = request.user
    new_password = request.data.get('new_password', '')

    if len(new_password) < 8:
        return Response(
            {'error': 'New password must be at least 8 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if user.has_usable_password():
        old_password = request.data.get('old_password', '')
        if not old_password:
            return Response(
                {'error': 'Current password is required to change your password.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user.check_password(old_password):
            return Response(
                {'error': 'Current password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    user.set_password(new_password)
    user.save()

    # Issue fresh tokens so the user doesn't get logged out
    refresh = RefreshToken.for_user(user)
    return Response({
        'message': 'Password updated successfully.',
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    })


# ─── POST /api/auth/set-password/<user_id>/ ───────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def set_password_view(request, user_id):
    """
    SuperAdmin-only: assign (or reset) a password for any user account.
    This is the only way to activate accounts that were migrated with set_unusable_password().
    Expects { password }.
    """
    requester_role = getattr(getattr(request.user, 'profile', None), 'role', None)
    if requester_role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can set passwords for other users.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        target_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    new_password = request.data.get('password', '')
    if len(new_password) < 8:
        return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)

    target_user.set_password(new_password)
    target_user.save()
    return Response({'message': f"Password set for user '{target_user.username}'."})


# ─── POST /api/auth/logout/ ──────────────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """
    Blacklists the provided refresh token on logout.
    Expects { refresh }.
    """
    from rest_framework_simplejwt.exceptions import TokenError
    refresh_token = request.data.get('refresh')
    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError:
            pass  # Already invalid — that's fine
    return Response({'message': 'Logged out successfully.'})


# ─── GET /api/auth/users/ ─────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def users_list_view(request):
    """
    SuperAdmin-only: return all user accounts with their profile data.
    Used by the User Management UI.
    """
    requester_role = getattr(getattr(request.user, 'profile', None), 'role', None)
    if requester_role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can view all users.'}, status=status.HTTP_403_FORBIDDEN)

    users = User.objects.select_related('profile', 'profile__employee').all().order_by('username')
    data = []
    for u in users:
        try:
            profile = u.profile
            emp = profile.employee
            role = profile.role
            emp_name = emp.name if emp else u.username
            emp_id = emp.id if emp else None
        except UserProfile.DoesNotExist:
            role = 'Member'
            emp_name = u.username
            emp_id = None

        data.append({
            'id': u.id,
            'username': u.username,
            'role': role,
            'employee_id': emp_id,
            'employee_name': emp_name,
            'is_active': u.is_active,
            'has_usable_password': u.has_usable_password(),
        })

    return Response(data)



# ─── POST /api/auth/users/create/ ──────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_user_view(request):
    """
    SuperAdmin-only: create a new User account linked to an existing Employee.
    Expects { username, password, role, employee_id (optional) }.
    """
    requester_role = getattr(getattr(request.user, 'profile', None), 'role', None)
    if requester_role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can create users.'}, status=status.HTTP_403_FORBIDDEN)

    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')
    role = request.data.get('role', 'Member').strip()
    employee_id = request.data.get('employee_id')

    if not username:
        return Response({'error': 'Username is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(password) < 8:
        return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({'error': f"Username '{username}' is already taken."}, status=status.HTTP_400_BAD_REQUEST)

    valid_roles = {'SuperAdmin', 'President', 'Vice President', 'Secretary', 'Treasurer', 'Member'}
    if role not in valid_roles:
        return Response({'error': f"Invalid role."}, status=status.HTTP_400_BAD_REQUEST)

    emp = None
    if employee_id:
        emp = Employee.objects.filter(id=employee_id).first()
        if not emp:
            return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)
        # Ensure no other user is already linked to this employee
        if hasattr(emp, 'user_profile') and emp.user_profile.user:
            return Response({'error': f"Employee '{emp.name}' already has a linked user account."}, status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.create_user(username=username, password=password)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.role = role
    if emp:
        profile.employee = emp
    profile.save()

    return Response({
        'id': user.id,
        'username': user.username,
        'role': profile.role,
        'employee_id': emp.id if emp else None,
        'employee_name': emp.name if emp else username,
        'is_active': user.is_active,
        'has_usable_password': True,
    }, status=status.HTTP_201_CREATED)


# ─── POST /api/auth/set-role/<user_id>/ ──────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def set_role_view(request, user_id):
    """
    SuperAdmin-only: change the role of any user.
    Expects { role }.
    SuperAdmin cannot change their own role (safety guardrail).
    """
    requester_role = getattr(getattr(request.user, 'profile', None), 'role', None)
    if requester_role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can change user roles.'}, status=status.HTTP_403_FORBIDDEN)

    if request.user.id == user_id:
        return Response({'error': 'SuperAdmin cannot change their own role.'}, status=status.HTTP_400_BAD_REQUEST)

    valid_roles = {'SuperAdmin', 'President', 'Vice President', 'Secretary', 'Treasurer', 'Member'}
    new_role = request.data.get('role', '').strip()
    if new_role not in valid_roles:
        return Response({'error': f"Invalid role. Must be one of: {', '.join(valid_roles)}"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        target_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Get or create profile
    profile, _ = UserProfile.objects.get_or_create(user=target_user)
    old_role = profile.role
    profile.role = new_role
    profile.save()

    return Response({'message': f"Role changed from '{old_role}' to '{new_role}' for user '{target_user.username}'."})


# ─── POST /api/auth/toggle-active/<user_id>/ ─────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_active_view(request, user_id):
    """
    SuperAdmin-only: activate or deactivate a user account.
    Expects { is_active: bool }.
    SuperAdmin cannot deactivate their own account.
    """
    requester_role = getattr(getattr(request.user, 'profile', None), 'role', None)
    if requester_role != 'SuperAdmin':
        return Response({'error': 'Only SuperAdmin can activate/deactivate users.'}, status=status.HTTP_403_FORBIDDEN)

    if request.user.id == user_id:
        return Response({'error': 'SuperAdmin cannot deactivate their own account.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        target_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    is_active = bool(request.data.get('is_active', True))
    target_user.is_active = is_active
    target_user.save()

    action = 'activated' if is_active else 'deactivated'
    return Response({'message': f"User '{target_user.username}' has been {action}."})

