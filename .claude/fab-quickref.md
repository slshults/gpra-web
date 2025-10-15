# Flask-AppBuilder Quick Reference

Quick reference for common Flask-AppBuilder patterns used in this project. Always check [official docs](https://flask-appbuilder.readthedocs.io/en/latest/) first.

## Core Documentation Links

- **Security & Auth**: https://flask-appbuilder.readthedocs.io/en/latest/security.html
- **User Registration**: https://flask-appbuilder.readthedocs.io/en/latest/security.html#authentication-methods
- **OAuth**: https://flask-appbuilder.readthedocs.io/en/latest/security.html#oauth-authentication
- **API Reference**: https://flask-appbuilder.readthedocs.io/en/latest/api.html
- **Config Options**: https://flask-appbuilder.readthedocs.io/en/latest/config.html

## Authentication Patterns

### Database Auth (Current Setup)
```python
# config.py
AUTH_TYPE = AUTH_DB  # Username/password in database
AUTH_USER_REGISTRATION = True  # Enable self-registration
AUTH_USER_REGISTRATION_ROLE = "Public"  # Default role for new users
```

### OAuth Setup (Google - Planned)
```python
# config.py
AUTH_TYPE = AUTH_OAUTH
OAUTH_PROVIDERS = [
    {
        "name": "google",
        "icon": "fa-google",
        "token_key": "access_token",
        "remote_app": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "api_base_url": "https://www.googleapis.com/oauth2/v2/",
            "client_kwargs": {"scope": "email profile"},
            "request_token_url": None,
            "access_token_url": "https://accounts.google.com/o/oauth2/token",
            "authorize_url": "https://accounts.google.com/o/oauth2/auth",
        }
    }
]
```

## Security Manager Access

```python
# In Flask routes/views
from flask import current_app
from flask_login import current_user

# Get security manager
appbuilder = current_app.extensions['appbuilder']
security_manager = appbuilder.sm

# Current user info
user = current_user
user_id = current_user.id
username = current_user.username
email = current_user.email
is_authenticated = current_user.is_authenticated

# Check permissions
has_permission = security_manager.has_access('can_read', 'SomeView')
```

## User Registration Hooks

```python
# In __init__.py or custom security manager
@appbuilder.sm.register_views_created
def post_register(user):
    """Called after user registration - use for auto-creating subscriptions"""
    # Example: Create free subscription tier
    from app.services.subscription_service import SubscriptionService
    subscription_service = SubscriptionService()
    subscription_service.create_subscription(
        user_id=user.id,
        tier='free'
    )
```

## Custom Views & Login Redirect

```python
# Custom auth view to redirect after login
from flask_appbuilder.security.views import AuthDBView

class CustomAuthDBView(AuthDBView):
    login_template = 'appbuilder/general/security/login_db.html'

    @expose('/login/', methods=['GET', 'POST'])
    def login(self):
        # Custom login logic
        response = super().login()
        if current_user.is_authenticated:
            return redirect('/')  # Redirect to main app, not /admin/
        return response

# Register custom view
appbuilder.security_manager_class = CustomAuthDBView
```

## Session Management

**CRITICAL**: Multi-worker setups (Gunicorn with >1 worker) need shared session storage.

```python
# config.py - For production with Redis
SESSION_TYPE = 'redis'
SESSION_REDIS = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379'))
SECRET_KEY = os.getenv('SECRET_KEY')  # Must be consistent across workers
```

## Common Configuration Options

```python
# config.py essentials for multi-tenant setup

# Authentication
AUTH_TYPE = AUTH_DB
AUTH_USER_REGISTRATION = True
AUTH_USER_REGISTRATION_ROLE = "Public"
AUTH_ROLE_ADMIN = "Admin"
AUTH_ROLE_PUBLIC = "Public"

# Session (production)
SECRET_KEY = os.getenv('SECRET_KEY')
SESSION_COOKIE_SECURE = True  # HTTPS only
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'

# Security
WTF_CSRF_ENABLED = True
WTF_CSRF_TIME_LIMIT = None  # Don't expire CSRF tokens

# Database
SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
SQLALCHEMY_TRACK_MODIFICATIONS = False
```

## Extending User Model

```python
# models.py - Add custom fields to User
from flask_appbuilder import Model
from flask_appbuilder.security.sqla.models import User
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship

class Subscription(Model):
    __tablename__ = 'subscriptions'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('ab_user.id'), nullable=False)
    tier = Column(String(50), default='free')

    user = relationship('User', backref='subscriptions')

# Access in code
user = current_user
subscription = user.subscriptions[0] if user.subscriptions else None
```

## Common Pitfalls

1. **Multi-worker CSRF issues**: Need Redis-backed sessions (see Session Management above)
2. **Login redirect loops**: Override AuthDBView to redirect to `/` not `/admin/`
3. **User registration hooks**: Use `@appbuilder.sm.register_views_created`, not custom registration views
4. **Permission sync**: Run `flask fab create-permissions` after model/view changes
5. **Static files**: FAB static files must be committed to git for production (see `app/static/appbuilder/`)

## Current Project Setup

- **Auth Type**: Database (AUTH_DB)
- **Registration**: Enabled with auto-free-tier subscription
- **Admin Interface**: Mounted at `/admin/`
- **Custom Login**: Redirects to `/` after successful login
- **RLS Middleware**: Active for multi-tenant data isolation
- **Production Issue**: CSRF failing due to multi-worker session sharing → needs Flask-Session + Redis
