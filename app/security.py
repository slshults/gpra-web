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

        # Generate state for CSRF protection
        random_state = generate_random_string()
        state = jwt.encode(
            request.args.to_dict(flat=False), random_state, algorithm="HS256"
        )
        session["oauth_state"] = random_state

        # Determine redirect_uri
        is_production = os.getenv('FLASK_ENV') == 'production'

        if is_production:
            # Production: Use url_for to auto-generate HTTPS redirect_uri based on request domain
            # ProxyFix middleware ensures url_for generates HTTPS URLs correctly
            redirect_uri = url_for(".oauth_authorized", provider=provider, _external=True)
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
                    'C:\\Users\\Username\\Documents\\Guitar\\Songbook\\ForWhatItsWorth',
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

            # 5. Set as active routine
            # NOTE: ActiveRoutine table doesn't have user_id yet (needs migration for multi-tenant)
            # For now, just set it without user_id - will be filtered by RLS when user queries
            db.execute(text("""
                INSERT INTO active_routine (id, routine_id, updated_at)
                VALUES (1, :routine_id, NOW())
                ON CONFLICT (id) DO UPDATE
                SET routine_id = :routine_id, updated_at = NOW()
            """), {'routine_id': routine_id})

            logger.info(f"Set demo routine as active")

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

            # Generate placeholder email (not a real email, just for database)
            email = f"tidal_{user_id}@gpra.local"

            return {
                'email': email,
                'username': username,
                'first_name': 'Tidal',
                'last_name': 'User',
            }
        # TODO: Additional OAuth providers can be added here
        return {}
