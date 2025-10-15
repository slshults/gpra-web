"""
Custom Security Manager for Flask-AppBuilder with OAuth integration
"""
import logging
from flask_appbuilder.security.sqla.manager import SecurityManager
from flask_appbuilder.security.views import UserDBModelView, AuthDBView
from flask_appbuilder.security.forms import RegisterUserDBForm
from flask_appbuilder.security.registerviews import BaseRegisterUser
from flask_appbuilder._compat import as_unicode
from flask import flash, redirect
from flask_babel import lazy_gettext
from flask_appbuilder import expose
from wtforms import StringField, PasswordField, HiddenField
from wtforms.validators import DataRequired, EqualTo, Email
import os

logger = logging.getLogger(__name__)


class DummyRecaptchaField(HiddenField):
    """
    Dummy recaptcha field that doesn't validate.

    This replaces the real RecaptchaField to bypass Google reCAPTCHA validation
    during development/testing.
    """
    def __init__(self, *args, **kwargs):
        super(DummyRecaptchaField, self).__init__(*args, **kwargs)
        self.data = ''  # Ensure data attribute exists

    def pre_validate(self, form):
        """Override pre-validation to always pass."""
        pass


class CustomRegisterUserDBForm(RegisterUserDBForm):
    """
    Custom registration form without reCAPTCHA.

    Flask-AppBuilder's default form includes reCAPTCHA which requires API keys.
    This custom form replaces reCAPTCHA with a dummy field that doesn't validate.
    """
    # Explicitly define all fields
    username = StringField('User Name', validators=[DataRequired()])
    first_name = StringField('First Name', validators=[DataRequired()])
    last_name = StringField('Last Name', validators=[DataRequired()])
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    conf_password = PasswordField('Confirm Password', validators=[DataRequired(), EqualTo('password', message='Passwords must match')])

    # Replace real RecaptchaField with dummy field that doesn't validate
    recaptcha = DummyRecaptchaField()

    def __init__(self, *args, **kwargs):
        """Replace parent's recaptcha field with our dummy field."""
        super(CustomRegisterUserDBForm, self).__init__(*args, **kwargs)
        # Force replace the recaptcha field that was inherited from parent
        # Create dummy field and bind it to this form properly
        dummy = DummyRecaptchaField()
        dummy = dummy.bind(self, 'recaptcha')
        self._fields['recaptcha'] = dummy
        # Also update the attribute
        object.__setattr__(self, 'recaptcha', dummy)


class ImmediateRegisterUserDBView(BaseRegisterUser):
    """
    Custom registration view that immediately activates users without email verification.

    This bypasses Flask-AppBuilder's default email-based activation flow,
    which requires Flask-Mail to be installed and configured.
    """
    form = CustomRegisterUserDBForm
    redirect_url = "/login/"
    message = lazy_gettext("User registered successfully. You can now login.")
    error_message = lazy_gettext("Registration failed. Please try again.")

    def form_get(self, form):
        """Add unique validations when form is displayed"""
        self.add_form_unique_validations(form)

    def form_post(self, form):
        """
        Process registration form and immediately create active user.

        Bypasses the email activation flow by directly calling add_user().
        """
        self.add_form_unique_validations(form)

        # Get the Public role for new users
        role = self.appbuilder.sm.find_role(
            self.appbuilder.sm.auth_user_registration_role
        )

        if not role:
            flash(as_unicode("Public role not found. Cannot register user."), "danger")
            return

        # Directly create active user (skip registration table + email)
        user = self.appbuilder.sm.add_user(
            username=form.username.data,
            first_name=form.first_name.data,
            last_name=form.last_name.data,
            email=form.email.data,
            role=role,
            password=form.password.data  # Will be hashed by add_user()
        )

        if user:
            flash(as_unicode(self.message), "success")
            logger.info(f"User registered successfully: {user.username} (id={user.id})")

            # Call post_register hook to create free subscription
            self.post_register(user)
        else:
            flash(as_unicode(self.error_message), "danger")
            logger.error(f"Failed to register user: {form.username.data}")

    def post_register(self, user):
        """
        Called after a new user is created.

        Creates a free tier subscription for new users.

        Args:
            user: Newly created User model instance
        """
        logger.info(f"Creating free subscription for user: {user.email} (id={user.id})")

        try:
            from sqlalchemy import text
            # Get Flask-AppBuilder's session
            db = self.appbuilder.session

            # Insert subscription record using raw SQL
            db.execute(text("""
                INSERT INTO subscriptions (user_id, tier, status, mrr, created_at, updated_at)
                VALUES (:user_id, 'free', 'active', 0.00, NOW(), NOW())
            """), {'user_id': user.id})
            db.commit()
            logger.info(f"Created free subscription for user {user.id}")
        except Exception as e:
            logger.error(f"Failed to create subscription for user {user.id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            db.rollback()


class CustomAuthDBView(AuthDBView):
    """
    Custom authentication views for login/logout.

    Extends Flask-AppBuilder's default auth views.
    Redirects to main app (/) after login instead of admin interface (/admin/).
    """

    @expose('/login/', methods=['GET', 'POST'])
    def login(self):
        """
        Override login to redirect to main app (/) instead of /admin/ after successful login.

        Simplified version that doesn't rely on internal Flask-AppBuilder APIs.
        """
        from flask import g, request
        from flask_appbuilder.security.forms import LoginForm_db
        from flask_login import login_user

        # If already authenticated, redirect to main app
        if g.user is not None and g.user.is_authenticated:
            return redirect('/')

        form = LoginForm_db()

        if form.validate_on_submit():
            # Authenticate user
            user = self.appbuilder.sm.auth_user_db(
                form.username.data, form.password.data
            )

            if not user:
                flash(as_unicode(self.invalid_login_message), "warning")
                # Redirect back to login page
                next_url = request.args.get("next", "")
                if next_url:
                    return redirect(f'/login/?next={next_url}')
                return redirect('/login/')

            # Login successful
            login_user(user, remember=False)

            # Check for next parameter, otherwise redirect to main app
            next_url = request.args.get("next", "/")
            if not next_url or next_url == "/admin/":
                # Default to main app, not admin interface
                return redirect('/')
            return redirect(next_url)

        # Show login form
        return self.render_template(
            self.login_template,
            title=self.title,
            form=form,
            appbuilder=self.appbuilder
        )


class CustomRegisterUserDBView_OLD(AuthDBView):
    """
    OLD: Custom authentication views.

    NOTE: This class is no longer used. Registration is now handled by
    ImmediateRegisterUserDBView above. Keeping for reference.
    """
    # Use custom registration form without reCAPTCHA
    add_form = CustomRegisterUserDBForm

    def post_register(self, user):
        """
        Called after a new user registers.

        We create a free tier subscription for new users here.

        Args:
            user: Newly created User model instance
        """
        logger.info(f"New user registered: {user.email} (id={user.id})")

        # Create free tier subscription for new user using raw SQL
        # (Our Subscription model uses a different SQLAlchemy Base than Flask-AppBuilder)
        try:
            from sqlalchemy import text
            # Use Flask-AppBuilder's session which has access to ab_user table
            db = self.get_session()

            # Insert subscription record using raw SQL
            db.execute(text("""
                INSERT INTO subscriptions (user_id, tier, status, mrr, created_at, updated_at)
                VALUES (:user_id, 'free', 'active', 0.00, NOW(), NOW())
            """), {'user_id': user.id})
            db.commit()
            logger.info(f"Created free subscription for user {user.id}")
        except Exception as e:
            logger.error(f"Failed to create subscription for user {user.id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            db.rollback()


class CustomSecurityManager(SecurityManager):
    """
    Custom Security Manager for OAuth and immediate user activation.

    Configuration is done via Flask app.config (see app/__init__.py):
    - AUTH_USER_REGISTRATION = True
    - AUTH_USER_REGISTRATION_ROLE = 'Public'
    - OAUTH_PROVIDERS = [...]
    """

    # Use custom registration view that immediately activates users (no email required)
    registeruserdbview = ImmediateRegisterUserDBView

    # Use custom auth view for login/logout
    authdbview = CustomAuthDBView

    # OAuth providers configuration
    oauth_providers = [
        {
            'name': 'google',
            'icon': 'fa-google',
            'token_key': 'access_token',
            'remote_app': {
                'client_id': os.getenv('GOOGLE_CLIENT_ID'),
                'client_secret': os.getenv('GOOGLE_CLIENT_SECRET'),
                'api_base_url': 'https://www.googleapis.com/oauth2/v2/',
                'client_kwargs': {
                    'scope': 'email profile'
                },
                'request_token_url': None,
                'access_token_url': 'https://accounts.google.com/o/oauth2/token',
                'authorize_url': 'https://accounts.google.com/o/oauth2/auth',
            }
        },
        # SoundCloud OAuth coming soon
        # {
        #     'name': 'soundcloud',
        #     'icon': 'fa-soundcloud',
        #     'token_key': 'access_token',
        #     'remote_app': {
        #         'client_id': os.getenv('SOUNDCLOUD_CLIENT_ID'),
        #         'client_secret': os.getenv('SOUNDCLOUD_CLIENT_SECRET'),
        #         'api_base_url': 'https://api.soundcloud.com/',
        #         'client_kwargs': {
        #             'scope': 'non-expiring'
        #         },
        #         'access_token_url': 'https://api.soundcloud.com/oauth2/token',
        #         'authorize_url': 'https://secure.soundcloud.com/connect',
        #     }
        # }
    ]

    def __init__(self, appbuilder):
        """
        Initialize custom security manager.

        Creates default roles if they don't exist:
        - Admin: Full access to admin interface
        - Public: Default role for new users (can use main app)
        """
        super(CustomSecurityManager, self).__init__(appbuilder)

        # Log OAuth configuration status
        if os.getenv('GOOGLE_CLIENT_ID'):
            logger.info("Google OAuth configured")
        else:
            logger.warning("Google OAuth not configured - missing GOOGLE_CLIENT_ID")

    def oauth_user_info(self, provider, response=None):
        """
        Extract user info from OAuth provider response.

        This is called when a user logs in via OAuth to extract email, name, etc.

        Args:
            provider: OAuth provider name ('google', 'soundcloud')
            response: OAuth provider response with user data

        Returns:
            Dictionary with user info: email, username, first_name, last_name
        """
        if provider == 'google':
            # Google OAuth response structure
            me = self.appbuilder.sm.oauth_remotes[provider].get('userinfo')
            data = me.json()
            logger.info(f"Google OAuth user info: {data.get('email')}")
            return {
                'email': data.get('email', ''),
                'username': data.get('email', '').split('@')[0],  # Use email prefix as username
                'first_name': data.get('given_name', ''),
                'last_name': data.get('family_name', ''),
            }
        # TODO: SoundCloud OAuth coming soon
        return {}
