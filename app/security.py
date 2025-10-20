"""
Custom Security Manager for Flask-AppBuilder with OAuth integration
"""
import logging
from flask_appbuilder.security.sqla.manager import SecurityManager
from flask_appbuilder.security.views import UserDBModelView, AuthDBView, AuthOAuthView
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


class CustomAuthOAuthView(AuthOAuthView):
    """
    Custom OAuth authentication view.

    Redirects to main app (/) after successful OAuth login instead of admin interface (/admin/).
    Overrides login() to force correct redirect_uri in development mode.
    """

    @expose('/login/<provider>')
    def login(self, provider=None):
        """
        Override login to force correct redirect_uri in development mode.

        Flask-AppBuilder's default login uses url_for() which generates redirect_uri
        based on the incoming request. This causes issues when browsers strip the port
        number, resulting in http://localhost/oauth-authorized/google instead of
        http://localhost:5000/oauth-authorized/google.
        """
        from flask import g, session, request, url_for
        from flask_appbuilder.security.views import generate_random_string
        import jwt

        # If already authenticated, redirect to main app
        if g.user is not None and g.user.is_authenticated:
            logger.debug(f"Already authenticated: {g.user}")
            return redirect('/')

        if provider is None:
            # Show provider selection page
            return self.render_template(
                self.login_template,
                providers=self.appbuilder.sm.oauth_providers,
                title=self.title,
                appbuilder=self.appbuilder,
            )

        logger.info(f"Initiating OAuth login with provider: {provider}")

        # Generate state for CSRF protection
        random_state = generate_random_string()
        state = jwt.encode(
            request.args.to_dict(flat=False), random_state, algorithm="HS256"
        )
        session["oauth_state"] = random_state

        # Determine redirect_uri
        is_production = os.getenv('FLASK_ENV') == 'production'

        if is_production:
            # Production: Let url_for auto-generate based on request domain
            redirect_uri = url_for(
                ".oauth_authorized", provider=provider, _external=True
            )
            logger.info(f"OAuth production mode: auto-generated redirect_uri = {redirect_uri}")
        else:
            # Development: Force localhost:5000 to match Google Console whitelist
            redirect_uri = f'http://localhost:5000/oauth-authorized/{provider}'
            logger.info(f"OAuth development mode: forcing redirect_uri = {redirect_uri}")

        try:
            # Call authorize_redirect with our explicit redirect_uri
            return self.appbuilder.sm.oauth_remotes[provider].authorize_redirect(
                redirect_uri=redirect_uri,
                state=state.decode("ascii") if isinstance(state, bytes) else state,
            )
        except Exception as e:
            logger.error(f"Error on OAuth authorize: {e}")
            flash(as_unicode(self.invalid_login_message), "warning")
            return redirect('/')

    @expose('/oauth-authorized/<provider>')
    def oauth_authorized(self, provider):
        """
        OAuth callback handler - redirects to main app instead of /admin/ after successful login.
        """
        from flask import g, request, session
        from flask_login import login_user

        logger.info(f"OAuth callback from provider: {provider}")

        # Get OAuth token from provider
        try:
            resp = self.appbuilder.sm.oauth_remotes[provider].authorize_access_token()
        except Exception as e:
            logger.error(f"OAuth token error: {e}")
            flash(as_unicode(f"OAuth login failed: {e}"), "danger")
            return redirect('/login')

        # Get user info from OAuth provider
        if resp is None:
            flash(as_unicode("Access denied"), "warning")
            return redirect('/login')

        logger.info(f"OAuth token received from {provider}")

        # Extract user info
        userinfo = self.appbuilder.sm.oauth_user_info(provider, resp)

        if userinfo is None or not userinfo.get('email'):
            flash(as_unicode("Failed to retrieve user information"), "danger")
            return redirect('/login')

        logger.info(f"OAuth user info: {userinfo.get('email')}")

        # Find or create user
        user = self.appbuilder.sm.auth_user_oauth(userinfo)

        if user is None:
            flash(as_unicode("OAuth login failed"), "danger")
            return redirect('/login')

        # Login user
        login_user(user, remember=False)
        logger.info(f"User logged in via OAuth: {user.username}")

        # Redirect to main app instead of /admin/
        return redirect('/')


class CustomAuthDBView(AuthDBView):
    """
    Custom authentication views for login/logout.

    Extends Flask-AppBuilder's default auth views.
    Redirects to main app (/) after login instead of admin interface (/admin/).
    Redirects to /login after logout instead of /admin/.
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

    @expose('/logout/')
    def logout(self):
        """
        Override logout to redirect to /login instead of /admin/.
        """
        from flask_login import logout_user

        logout_user()
        flash(as_unicode('You have been logged out.'), 'info')
        return redirect('/login')


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
    Custom Security Manager for hybrid authentication (database + OAuth).

    Configuration is done via Flask app.config (see app/__init__.py):
    - AUTH_TYPE = 1 (AUTH_DB - database authentication)
    - AUTH_USER_REGISTRATION = True
    - AUTH_USER_REGISTRATION_ROLE = 'Public'
    - OAUTH_PROVIDERS = [...]

    This manager supports BOTH database authentication (email/password)
    AND OAuth authentication (Google, SoundCloud, etc.) simultaneously.
    Flask-AppBuilder doesn't support this by default, so we manually
    initialize OAuth in __init__ and register the OAuth view.
    """

    # Use custom registration view that immediately activates users (no email required)
    registeruserdbview = ImmediateRegisterUserDBView

    # Use custom auth view for login/logout (database authentication)
    authdbview = CustomAuthDBView

    # Use custom OAuth view that redirects to main app instead of /admin/
    authoauthview = CustomAuthOAuthView

    # NOTE: OAuth providers are configured via app.config['OAUTH_PROVIDERS'] in app/__init__.py
    # DO NOT define oauth_providers as a class attribute here, as it overrides Flask-AppBuilder's
    # ability to read from app.config and register OAuth routes properly.

    def __init__(self, appbuilder):
        """
        Initialize custom security manager.

        Creates default roles if they don't exist:
        - Admin: Full access to admin interface
        - Public: Default role for new users (can use main app)

        Also manually initializes OAuth support even though AUTH_TYPE = AUTH_DB.
        Flask-AppBuilder normally only initializes OAuth when AUTH_TYPE = AUTH_OAUTH,
        but we want to support BOTH database login AND OAuth login.
        """
        super(CustomSecurityManager, self).__init__(appbuilder)

        # Manually initialize OAuth support (FAB only does this when AUTH_TYPE == AUTH_OAUTH)
        # We need it for AUTH_DB + OAuth hybrid authentication
        from flask import current_app
        if self.oauth_providers:
            logger.info("Initializing OAuth providers for hybrid auth (DB + OAuth)")
            from authlib.integrations.flask_client import OAuth

            self.oauth = OAuth(current_app)
            self.oauth_remotes = {}
            for _provider in self.oauth_providers:
                provider_name = _provider["name"]
                logger.info(f"Registering OAuth provider: {provider_name}")
                obj_provider = self.oauth.register(
                    provider_name, **_provider["remote_app"]
                )
                obj_provider._tokengetter = self.oauth_tokengetter
                if not self.oauth_user_info:
                    self.oauth_user_info = self.get_oauth_user_info
                # Whitelist only users with matching emails
                if "whitelist" in _provider:
                    self.oauth_whitelists[provider_name] = _provider["whitelist"]
                self.oauth_remotes[provider_name] = obj_provider
                logger.info(f"OAuth provider '{provider_name}' registered successfully")
        else:
            logger.warning("No OAuth providers configured")

    def register_views(self):
        """
        Override register_views to support hybrid authentication (DB + OAuth).

        Flask-AppBuilder's default implementation only registers ONE auth view
        based on AUTH_TYPE. We want to register BOTH authdbview (for email/password)
        AND authoauthview (for Google OAuth).
        """
        # Call parent to register all standard views (including authdbview)
        super(CustomSecurityManager, self).register_views()

        # Additionally register OAuth view if we have OAuth providers configured
        if self.oauth_providers:
            logger.info("Registering OAuth authentication view for hybrid auth")
            oauth_view = self.authoauthview()
            self.appbuilder.add_view_no_menu(oauth_view)
            logger.info("OAuth authentication view registered at /login/<provider>")

    def generate_unique_username(self, base_username):
        """
        Generate a unique username by appending a counter if base_username exists.

        Args:
            base_username: Starting username (typically email prefix)

        Returns:
            Unique username that doesn't exist in ab_user table
        """
        from flask_appbuilder.security.sqla.models import User

        # Try base username first
        username = base_username
        counter = 1

        # Keep trying with incremented counter until we find an available username
        while self.find_user(username=username):
            username = f"{base_username}{counter}"
            counter += 1

            # Safety limit to prevent infinite loops
            if counter > 1000:
                # Fallback to email prefix + random string
                import secrets
                username = f"{base_username}_{secrets.token_hex(4)}"
                break

        logger.info(f"Generated unique username: {username} (base: {base_username})")
        return username

    def auth_user_oauth(self, userinfo):
        """
        Authenticate OAuth user - find existing or create new user.

        This is called after oauth_user_info extracts the user data.
        Creates new users with Public role and free subscription.

        Args:
            userinfo: Dictionary with user info (email, username, first_name, last_name)

        Returns:
            User object if successful, None if failed
        """
        email = userinfo.get('email')
        username = userinfo.get('username')

        if not email:
            logger.error("OAuth login failed: no email in userinfo")
            return None

        logger.info(f"Authenticating OAuth user: {email}")

        # Try to find existing user by email
        user = self.find_user(email=email)

        if user:
            logger.info(f"Found existing OAuth user: {user.username}")
            # Update last login time
            user.last_login = self.appbuilder.session.query(self.user_model).filter_by(id=user.id).first().last_login
            self.appbuilder.session.commit()
            return user

        # Create new user
        logger.info(f"Creating new OAuth user: {email}")

        # Get Public role for new users
        role = self.find_role(self.auth_user_registration_role)
        if not role:
            logger.error("Public role not found - cannot create OAuth user")
            return None

        # Create user
        user = self.add_user(
            username=username,
            first_name=userinfo.get('first_name', ''),
            last_name=userinfo.get('last_name', ''),
            email=email,
            role=role
        )

        if not user:
            logger.error(f"Failed to create OAuth user: {email}")
            return None

        logger.info(f"Created OAuth user: {user.username} (id={user.id})")

        # Create free subscription for new OAuth user
        try:
            from sqlalchemy import text
            db = self.appbuilder.session

            db.execute(text("""
                INSERT INTO subscriptions (user_id, tier, status, mrr, created_at, updated_at)
                VALUES (:user_id, 'free', 'active', 0.00, NOW(), NOW())
            """), {'user_id': user.id})
            db.commit()
            logger.info(f"Created free subscription for OAuth user {user.id}")
        except Exception as e:
            logger.error(f"Failed to create subscription for OAuth user {user.id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            db.rollback()

        return user

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
            email = data.get('email', '')
            logger.info(f"Google OAuth user info: {email}")

            # Generate unique username from email prefix
            base_username = email.split('@')[0] if email else 'user'
            unique_username = self.generate_unique_username(base_username)

            return {
                'email': email,
                'username': unique_username,
                'first_name': data.get('given_name', ''),
                'last_name': data.get('family_name', ''),
            }
        # TODO: SoundCloud OAuth coming soon
        return {}
