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

        Creates a free tier subscription and demo data for new users.

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

        # Create demo data for first-run experience
        self.appbuilder.sm.create_demo_data_for_user(user)


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

        # Generate state for CSRF protection - include intent=login
        # Use app secret key for JWT (no need to store random secret in session)
        # This prevents conflicts with authlib's internal state management
        from flask import current_app
        state_data = request.args.to_dict(flat=False)
        state_data['intent'] = ['login']  # Mark this as login flow
        state = jwt.encode(state_data, current_app.config['SECRET_KEY'], algorithm="HS256")

        # DO NOT set session["oauth_state"] - let authlib handle its own state internally
        # authlib uses _state_{provider}_{state_value} pattern which conflicts with our custom key

        # Determine redirect_uri
        # IMPORTANT: Always use url_for to match the incoming request domain
        # This prevents session loss when user arrives via one domain but OAuth redirects to another
        # (e.g., 127.0.0.1 → localhost, or guitarpracticeroutine.net → guitarpracticeroutine.com)
        redirect_uri = url_for(".oauth_authorized", provider=provider, _external=True)
        logger.info(f"OAuth redirect_uri (matches incoming domain): {redirect_uri}")

        try:
            # Call authorize_redirect with our explicit redirect_uri
            # prompt='select_account' is configured in client_kwargs (app/__init__.py)
            # authorize_redirect handles state saving automatically via save_authorize_data()
            return self.appbuilder.sm.oauth_remotes[provider].authorize_redirect(
                redirect_uri=redirect_uri,
                state=state.decode("ascii") if isinstance(state, bytes) else state
            )
        except Exception as e:
            logger.error(f"Error on OAuth authorize: {e}")
            flash(as_unicode(self.invalid_login_message), "warning")
            return redirect('/')

    @expose('/oauth-signup/<provider>')
    def signup(self, provider=None):
        """
        OAuth signup endpoint - always creates new users and shows tour.

        This is separate from /login/<provider> to distinguish signup vs login intent.
        If user already exists, logs them in and shows tour anyway.
        """
        from flask import g, session, request, url_for
        from flask_appbuilder.security.views import generate_random_string
        import jwt

        # If already authenticated, redirect to main app
        if g.user is not None and g.user.is_authenticated:
            logger.debug(f"Already authenticated: {g.user}")
            return redirect('/')

        if provider is None:
            # Redirect to register page if no provider specified
            return redirect('/register')

        logger.info(f"Initiating OAuth signup with provider: {provider}")

        # Generate state for CSRF protection - include intent=signup
        # Use app secret key for JWT (no need to store random secret in session)
        # This prevents conflicts with authlib's internal state management
        from flask import current_app
        state_data = request.args.to_dict(flat=False)
        state_data['intent'] = ['signup']  # Mark this as signup flow
        state = jwt.encode(state_data, current_app.config['SECRET_KEY'], algorithm="HS256")

        # DO NOT set session["oauth_state"] - let authlib handle its own state internally
        # authlib uses _state_{provider}_{state_value} pattern which conflicts with our custom key

        # Determine redirect_uri
        # IMPORTANT: Always use url_for to match the incoming request domain
        # This prevents session loss when user arrives via one domain but OAuth redirects to another
        # (e.g., 127.0.0.1 → localhost, or guitarpracticeroutine.net → guitarpracticeroutine.com)
        redirect_uri = url_for(".oauth_authorized", provider=provider, _external=True)
        logger.info(f"OAuth redirect_uri (matches incoming domain): {redirect_uri}")

        try:
            # Call authorize_redirect with our explicit redirect_uri
            # prompt='select_account' is configured in client_kwargs (app/__init__.py)
            # authorize_redirect handles state saving automatically via save_authorize_data()
            return self.appbuilder.sm.oauth_remotes[provider].authorize_redirect(
                redirect_uri=redirect_uri,
                state=state.decode("ascii") if isinstance(state, bytes) else state
            )
        except Exception as e:
            logger.error(f"Error on OAuth authorize: {e}")
            flash(as_unicode("OAuth signup failed. Please try again."), "warning")
            return redirect('/register')

    @expose('/oauth-authorized/<provider>')
    def oauth_authorized(self, provider):
        """
        OAuth callback handler - handles both login and signup flows.

        Checks the 'intent' in the JWT state to determine if this was initiated
        from /login/<provider> (login-only) or /oauth-signup/<provider> (signup).
        """
        from flask import g, request, session
        from flask_login import login_user
        import jwt

        logger.info(f"OAuth callback from provider: {provider}")

        # Get OAuth token from provider
        try:
            resp = self.appbuilder.sm.oauth_remotes[provider].authorize_access_token()
        except Exception as e:
            logger.error(f"OAuth token error: {e}")
            flash(as_unicode(f"OAuth authentication failed: {e}"), "danger")
            return redirect('/login')

        # Get user info from OAuth provider
        if resp is None:
            flash(as_unicode("Access denied"), "warning")
            return redirect('/login')

        logger.info(f"OAuth token received from {provider}")

        # Decode state to check intent (login vs signup)
        # State JWT is signed with app SECRET_KEY (not stored in session)
        intent = 'login'  # Default to login
        try:
            if request.args.get('state'):
                from flask import current_app
                state_jwt = request.args.get('state')
                # Decode using static SECRET_KEY (same as in login/signup methods)
                decoded_state = jwt.decode(state_jwt, current_app.config['SECRET_KEY'], algorithms=["HS256"])
                intent_list = decoded_state.get('intent', ['login'])
                intent = intent_list[0] if isinstance(intent_list, list) else intent_list
                logger.info(f"OAuth intent: {intent}")
        except Exception as e:
            logger.warning(f"Could not decode OAuth state, defaulting to login: {e}")

        # Extract user info
        userinfo = self.appbuilder.sm.oauth_user_info(provider, resp)

        if userinfo is None or not userinfo.get('email'):
            flash(as_unicode("Failed to retrieve user information"), "danger")
            redirect_url = '/register' if intent == 'signup' else '/login'
            return redirect(redirect_url)

        logger.info(f"OAuth user info: {userinfo.get('email')}")

        # Check if user already exists
        existing_user = self.appbuilder.sm.find_user(email=userinfo.get('email'))

        if intent == 'login':
            # LOGIN FLOW: Only authenticate existing users
            if not existing_user:
                logger.info(f"OAuth login failed - no account found for: {userinfo.get('email')}")
                flash(as_unicode("No account found. Please sign up first."), "warning")
                return redirect('/register')

            # User exists - log them in (no tour)
            user = existing_user

            # Mark session as permanent to persist across browser restarts
            from flask import session
            session.permanent = True

            login_user(user, remember=True)
            logger.info(f"User logged in via OAuth: {user.username}")
            return redirect('/')

        else:
            # SIGNUP FLOW: Create new user OR login existing (both get tour)
            if existing_user:
                # User already exists - log them in AND show tour
                logger.info(f"OAuth signup - user already exists: {userinfo.get('email')}")
                user = existing_user

                # Mark session as permanent to persist across browser restarts
                from flask import session
                session.permanent = True

                login_user(user, remember=True)
                logger.info(f"Existing user logged in via OAuth signup: {user.username}")
                # Redirect with show_tour flag
                return redirect('/?show_tour=true')
            else:
                # Create new user
                user = self.appbuilder.sm.auth_user_oauth(userinfo)

                if user is None:
                    flash(as_unicode("OAuth signup failed"), "danger")
                    return redirect('/register')

                # Mark session as permanent to persist across browser restarts
                from flask import session
                session.permanent = True

                # Login user (remember=True keeps session persistent across browser restarts)
                login_user(user, remember=True)
                logger.info(f"New user created and logged in via OAuth: {user.username}")
                # Redirect with show_tour flag
                return redirect('/?show_tour=true')


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

        logger.debug(f"Login method called - Request method: {request.method}")

        # If already authenticated, redirect to main app
        if g.user is not None and g.user.is_authenticated:
            logger.debug(f"Already authenticated: {g.user.username}")
            return redirect('/')

        form = LoginForm_db()
        logger.debug(f"Form created - Is POST: {request.method == 'POST'}")

        if form.validate_on_submit():
            logger.info(f"Form validated successfully - Username: {form.username.data}")

            # Authenticate user
            user = self.appbuilder.sm.auth_user_db(
                form.username.data, form.password.data
            )

            if not user:
                logger.warning(f"Authentication failed for username: {form.username.data}")
                flash(as_unicode(self.invalid_login_message), "warning")
                # Redirect back to login page
                next_url = request.args.get("next", "")
                if next_url:
                    return redirect(f'/login/?next={next_url}')
                return redirect('/login/')

            # Login successful (remember=True keeps session persistent across browser restarts)
            logger.info(f"Login successful for user: {user.username}")

            # Mark session as permanent to persist across browser restarts
            from flask import session
            session.permanent = True

            login_user(user, remember=True)

            # Check for next parameter, otherwise redirect to main app
            next_url = request.args.get("next", "/")
            if not next_url or next_url == "/admin/":
                # Default to main app, not admin interface
                return redirect('/')
            return redirect(next_url)
        else:
            if request.method == 'POST':
                logger.error(f"Form validation failed - Errors: {form.errors}")

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
        Clears Flask session, remember-me cookie, and logs out user.
        """
        from flask_login import logout_user
        from flask import session, current_app, make_response

        # Log out the user (clears Flask-Login session)
        logout_user()

        # Clear the entire Flask session to remove any OAuth state
        session.clear()

        # Create response and force session save
        response = make_response(redirect('/login'))
        current_app.session_interface.save_session(current_app, session, response)

        # Explicitly delete the remember-me cookie (Flask-Login sets this with remember=True)
        # This prevents automatic re-login on next request
        response.set_cookie('remember_token', '', expires=0, max_age=0)
        response.set_cookie('session', '', expires=0, max_age=0)

        flash(as_unicode('You have been logged out.'), 'info')
        return response


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


class CustomUserDBModelView(UserDBModelView):
    """
    Custom User Model View with delete protection.

    Prevents:
    - Users from deleting themselves
    - Deletion of the last admin user
    """

    def pre_delete(self, item):
        """
        Called before deleting a user - validates the deletion is allowed.

        Args:
            item: User object being deleted

        Raises:
            Exception: If deletion is not allowed
        """
        from flask_login import current_user

        # Prevent users from deleting themselves
        if current_user.id == item.id:
            # Convert to str() to avoid LazyString serialization issues with Redis sessions
            flash(str("You cannot delete your own account. Please have another admin delete it."), "danger")
            raise Exception("Cannot delete current user")

        # Check if this is the last admin user
        admin_role = self.appbuilder.sm.find_role('Admin')
        if admin_role and admin_role in item.roles:
            # Count how many admin users exist
            admin_count = self.appbuilder.session.query(self.datamodel.obj).join(
                self.datamodel.obj.roles
            ).filter(
                self.datamodel.obj.roles.contains(admin_role)
            ).count()

            if admin_count <= 1:
                # Convert to str() to avoid LazyString serialization issues with Redis sessions
                flash(str("Cannot delete the last admin user. Create another admin first."), "danger")
                raise Exception("Cannot delete last admin user")

        logger.info(f"User deletion validated: {item.username} (id={item.id})")


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

    # Use custom user view with delete protection
    userdbmodelview = CustomUserDBModelView

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

        Also customizes built-in menu category names:
        - 'Security' → 'Info & Perms'
        """
        # Call parent to register all standard views (including authdbview)
        super(CustomSecurityManager, self).register_views()

        # Additionally register OAuth view if we have OAuth providers configured
        if self.oauth_providers:
            logger.info("Registering OAuth authentication view for hybrid auth")
            oauth_view = self.authoauthview()
            self.appbuilder.add_view_no_menu(oauth_view)
            logger.info("OAuth authentication view registered at /login/<provider>")

        # Rename 'Security' menu to 'Info & Perms'
        # Flask-AppBuilder stores menu items in appbuilder.menu
        # We need to update both the category name and label
        for item in self.appbuilder.menu.menu:
            if item.name == 'Security':
                logger.info("Renaming 'Security' menu to 'Info & Perms'")
                item.name = 'Info & Perms'
                # Also update the label for display
                if hasattr(item, 'label'):
                    item.label = 'Info & Perms'
                break

    def auth_user_db(self, username, password):
        """
        Override auth_user_db to handle OAuth users with NULL passwords.

        OAuth users have password=NULL in the database and cannot login via password.
        Implements timing attack protection by executing fake hash check for OAuth users
        and non-existent users, preventing user enumeration via response time analysis.

        Args:
            username: Username or email to authenticate
            password: Password attempt

        Returns:
            User object if authentication succeeds, None if fails
        """
        from werkzeug.security import check_password_hash

        # Find user by username or email
        user = self.find_user(username=username)
        if not user:
            user = self.find_user(email=username)

        # Check if this is an OAuth user (password=NULL) or user doesn't exist
        if not user or user.password is None:
            # Timing attack protection: Execute fake hash check
            # to match the timing of real password validation (~100-300ms)
            # This prevents attackers from enumerating valid usernames by
            # measuring response time differences
            fake_hash = 'pbkdf2:sha256:260000$fake$5F9a3b8c2d1e0f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'
            check_password_hash(fake_hash, password or '')

            if not user:
                logger.debug(f"User not found: {username}")
            else:
                logger.info(f"Login attempt blocked for OAuth user: {username}")

            return None

        # Normal password check for non-OAuth users
        return super(CustomSecurityManager, self).auth_user_db(username, password)

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

        # Create user (without password - OAuth users don't have passwords)
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

        # Set password to NULL to mark as OAuth user (can't login with password)
        try:
            user.password = None
            self.appbuilder.session.commit()
            logger.info(f"Set password=NULL for OAuth user {user.username}")
        except Exception as e:
            logger.error(f"Failed to set NULL password for OAuth user: {e}")
            # Continue anyway - not critical

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

        # Create demo data for first-run experience
        self.create_demo_data_for_user(user)

        return user

    def create_demo_data_for_user(self, user):
        """
        Create demo routine and item for new user's first-run experience.

        Creates:
        - Demo item: "For What It's Worth" with basic info
        - Demo routine: "Demo routine"
        - 4 chord charts: E, A, E, A (Intro section)
        - Sets routine as active

        Args:
            user: Newly created User model instance

        Note:
            Fails silently to avoid blocking user registration if demo data creation fails.
        """
        logger.info(f"Creating demo data for user: {user.email} (id={user.id})")

        try:
            from sqlalchemy import text
            db = self.appbuilder.session

            # 1. Create demo item "For What It's Worth"
            item_result = db.execute(text("""
                INSERT INTO items (item_id, title, notes, duration, description, "order", tuning, songbook, user_id, created_at, updated_at)
                VALUES ('', 'For What It''s Worth',
                    'Classic Buffalo Springfield song - great for practicing basic chord changes',
                    '5',
                    'Work on smooth transitions between E and A chords. Focus on strumming pattern and timing.',
                    0, 'EADGBE',
                    'D:\\Users\\YourUserNameHere\\Documents\\Guitar\\Songbook\\ForWhatItsWorth',
                    :user_id, NOW(), NOW())
                RETURNING id, item_id
            """), {'user_id': user.id})

            item_row = item_result.fetchone()
            item_db_id = item_row[0]  # Database primary key

            # Update item_id to match database id (Google Sheets compatibility pattern)
            db.execute(text("""
                UPDATE items SET item_id = :item_id WHERE id = :id
            """), {'item_id': str(item_db_id), 'id': item_db_id})

            logger.info(f"Created demo item (id={item_db_id})")

            # 2. Create demo routine "Demo routine"
            routine_result = db.execute(text("""
                INSERT INTO routines (name, "order", user_id, created_at)
                VALUES ('Demo routine', 0, :user_id, NOW())
                RETURNING id
            """), {'user_id': user.id})

            routine_id = routine_result.fetchone()[0]
            logger.info(f"Created demo routine (id={routine_id})")

            # 3. Add item to routine
            db.execute(text("""
                INSERT INTO routine_items (routine_id, item_id, "order", completed, created_at)
                VALUES (:routine_id, :item_db_id, 0, FALSE, NOW())
            """), {'routine_id': routine_id, 'item_db_id': item_db_id})

            logger.info(f"Added item to routine")

            # 4. Create 4 chord charts (E, A, E, A) with Intro section
            # E chord (appears twice: positions 0 and 2)
            e_chord_data = {
                "fingers": [[2, 2, None], [3, 2, None], [4, 1, None]],
                "barres": [],
                "tuning": "EADGBE",
                "capo": 0,
                "startingFret": 1,
                "numFrets": 4,
                "numStrings": 6,
                "openStrings": [1, 6],
                "mutedStrings": [],
                "sectionId": "section-intro",
                "sectionLabel": "Intro",
                "sectionRepeatCount": "",
                "hasLineBreakAfter": False
            }

            # A chord (appears twice: positions 1 and 3)
            a_chord_data = {
                "fingers": [[2, 2, None], [3, 2, None], [4, 2, None]],
                "barres": [],
                "tuning": "EADGBE",
                "capo": 0,
                "startingFret": 1,
                "numFrets": 4,
                "numStrings": 6,
                "openStrings": [1, 5],
                "mutedStrings": [6],
                "sectionId": "section-intro",
                "sectionLabel": "Intro",
                "sectionRepeatCount": "",
                "hasLineBreakAfter": False
            }

            import json

            # Create E, A, E, A progression
            chord_sequence = [
                ('E', e_chord_data, 0),
                ('A', a_chord_data, 1),
                ('E', e_chord_data, 2),
                ('A', a_chord_data, 3)
            ]

            for title, chord_data, order in chord_sequence:
                db.execute(text("""
                    INSERT INTO chord_charts (item_id, title, chord_data, order_col, user_id, created_at)
                    VALUES (:item_id, :title, :chord_data, :order_col, :user_id, NOW())
                """), {
                    'item_id': str(item_db_id),
                    'title': title,
                    'chord_data': json.dumps(chord_data),
                    'order_col': order,
                    'user_id': user.id
                })

            logger.info(f"Created 4 chord charts (E, A, E, A)")

            # 5. Set demo routine as active in subscriptions.last_active_routine_id (per-user)
            db.execute(text("""
                UPDATE subscriptions
                SET last_active_routine_id = :routine_id
                WHERE user_id = :user_id
            """), {'routine_id': routine_id, 'user_id': user.id})

            logger.info(f"Set demo routine as active (routine_id={routine_id})")

            db.commit()
            logger.info(f"Demo data creation complete for user {user.id}")

        except Exception as e:
            logger.error(f"Failed to create demo data for user {user.id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            db.rollback()
            # Don't raise - fail silently to avoid blocking registration

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
        elif provider == 'tidal':
            # Tidal OAuth response structure (OAuth 2.1 with PKCE)
            # Tidal provides user_id in the token response, but no email/profile endpoint
            # We use user_id as the username and generate a placeholder email
            logger.info(f"Tidal token response keys: {response.keys() if hasattr(response, 'keys') else type(response)}")

            # Get user_id from token response
            user_id = response.get('user_id')
            if not user_id:
                logger.error("Tidal OAuth: No user_id in token response")
                return None

            logger.info(f"Tidal OAuth user_id: {user_id}")

            # Use user_id as username (e.g., "tidal_185352085")
            username = f"tidal_{user_id}"

            # Generate placeholder email (users can update via Stripe Customer Portal)
            email = f"tidal_{user_id}@gpra.app"

            return {
                'email': email,
                'username': username,
                'first_name': 'Tidal',
                'last_name': 'User',
            }
        # TODO: Additional OAuth providers can be added here
        return {}
