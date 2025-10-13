"""
Row-Level Security (RLS) middleware for multi-tenant data isolation.

This module provides two layers of security:
1. Application-level: Automatic query filtering by user_id
2. Database-level: PostgreSQL RLS policies as backup (optional)

Usage:
    Initialize in app/__init__.py:
        from app.middleware.rls import init_rls_middleware
        with app.app_context():
            init_rls_middleware(app, engine)

    Use in routes:
        from app.middleware.rls import require_user_context

        @app.route('/api/items')
        @require_user_context
        def get_items():
            # DataLayer automatically filters by user_id
            return jsonify(data_layer.get_all_items())

    Use in repositories:
        from app.middleware.rls import filter_by_user

        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.all()
"""
import logging
from flask import g
from flask_login import current_user
from functools import wraps
from sqlalchemy import event, text
from sqlalchemy.orm import Session
from typing import Optional

logger = logging.getLogger(__name__)


def init_rls_middleware(app, db_engine):
    """
    Initialize Row-Level Security middleware.

    Sets up application-level RLS enforcement with Flask request hooks.
    Call this from app/__init__.py after database initialization.

    Args:
        app: Flask application instance
        db_engine: SQLAlchemy engine instance
    """

    @app.before_request
    def set_current_user_context():
        """
        Store current user ID in Flask's g object for request duration.
        This is used by query filters and PostgreSQL RLS policies.

        The user context is set from Flask-Login's current_user when authenticated.
        If no user is authenticated, g.current_user_id will be None.
        """
        if current_user and current_user.is_authenticated:
            g.current_user_id = current_user.id
            logger.debug(f"RLS: User context set for user_id={current_user.id}")

            # Also set PostgreSQL session variable for RLS policies (if enabled)
            # This allows database-level RLS to work alongside application-level filtering
            try:
                with db_engine.connect() as conn:
                    conn.execute(
                        text("SET LOCAL app.current_user_id = :user_id"),
                        {"user_id": current_user.id}
                    )
                    conn.commit()
                    logger.debug(f"RLS: PostgreSQL session variable set for user_id={current_user.id}")
            except Exception as e:
                # Don't fail the request if PostgreSQL session variable fails
                # Application-level RLS will still work
                logger.warning(f"Failed to set PostgreSQL user context: {e}")
        else:
            g.current_user_id = None
            logger.debug("RLS: No authenticated user, context set to None")

    logger.info('Row-Level Security middleware initialized')


def get_current_user_id() -> Optional[int]:
    """
    Get current user ID from Flask request context.

    Returns:
        User ID if authenticated, None otherwise

    Usage:
        user_id = get_current_user_id()
        if user_id:
            # User is authenticated
            query = query.filter(Model.user_id == user_id)
    """
    return getattr(g, 'current_user_id', None)


def require_user_context(f):
    """
    Decorator to ensure user context exists.
    Use on API endpoints that require authentication.

    Returns 401 Unauthorized if no user context is present.

    Usage:
        @app.route('/api/items')
        @require_user_context
        def get_items():
            # User is guaranteed to be authenticated here
            items = data_layer.get_all_items()
            return jsonify(items)
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not get_current_user_id():
            from flask import jsonify
            logger.warning(f"RLS: Unauthorized access attempt to {f.__name__}")
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


def filter_by_user(query, model):
    """
    Add user_id filter to SQLAlchemy query for automatic RLS enforcement.

    This is the core application-level RLS function. It automatically
    filters queries to only return records belonging to the current user.

    Args:
        query: SQLAlchemy query object
        model: Model class (must have user_id attribute)

    Returns:
        Filtered query that only returns records for current user

    Usage:
        # In a repository method
        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.all()  # Only returns current user's items

    Note:
        If no user context exists (unauthenticated), the query is returned
        unchanged. This allows for gradual migration and backward compatibility.
        Use require_user_context decorator on routes to enforce authentication.
    """
    user_id = get_current_user_id()

    if user_id and hasattr(model, 'user_id'):
        logger.debug(f"RLS: Filtering {model.__name__} query by user_id={user_id}")
        return query.filter(model.user_id == user_id)
    elif user_id and not hasattr(model, 'user_id'):
        logger.warning(f"RLS: Model {model.__name__} does not have user_id attribute")
    else:
        logger.debug(f"RLS: No user context, returning unfiltered query for {model.__name__}")

    return query


def set_user_id_on_create(model_data: dict) -> dict:
    """
    Automatically set user_id on new records.

    Call this before creating any new Item, Routine, or ChordChart.

    Args:
        model_data: Dictionary of model attributes

    Returns:
        Updated dictionary with user_id set

    Usage:
        # In a service create method
        def create_item(self, item_data):
            item_data = set_user_id_on_create(item_data)
            return self.repository.create(item_data)
    """
    user_id = get_current_user_id()
    if user_id:
        model_data['user_id'] = user_id
        logger.debug(f"RLS: Set user_id={user_id} on new record")
    else:
        logger.warning("RLS: No user context when creating record, user_id not set")

    return model_data


def verify_user_ownership(record, allow_none: bool = False) -> bool:
    """
    Verify that the current user owns the given record.

    Use this before update/delete operations to ensure users can only
    modify their own data.

    Args:
        record: SQLAlchemy model instance with user_id attribute
        allow_none: If True, allow records with user_id=None (for migration)

    Returns:
        True if user owns the record, False otherwise

    Usage:
        # In a service update method
        def update_item(self, item_id, item_data):
            item = self.repository.get_by_id(item_id)
            if not verify_user_ownership(item):
                raise PermissionError("Cannot modify another user's item")
            return self.repository.update(item_id, item_data)
    """
    user_id = get_current_user_id()

    if not user_id:
        logger.warning("RLS: No user context for ownership verification")
        return False

    if not hasattr(record, 'user_id'):
        logger.warning(f"RLS: Record {record} does not have user_id attribute")
        return False

    if record.user_id is None and allow_none:
        # During migration, some records may not have user_id yet
        logger.debug(f"RLS: Allowing access to record with user_id=None")
        return True

    if record.user_id == user_id:
        logger.debug(f"RLS: Ownership verified for user_id={user_id}")
        return True
    else:
        logger.warning(f"RLS: Ownership verification failed - record belongs to user_id={record.user_id}, not {user_id}")
        return False


def setup_postgresql_rls_policies(db_engine, app):
    """
    Set up PostgreSQL Row-Level Security policies as backup defense-in-depth.

    *** WARNING: DO NOT CALL THIS YET ***
    This is optional and should only be enabled after thorough testing.
    It affects ALL database connections and can break the app if not configured correctly.

    When enabled, these policies work alongside application-level RLS to provide
    defense-in-depth security. Even if application code bypasses filtering,
    the database will still enforce row-level isolation.

    The policies use PostgreSQL's RLS feature to automatically filter queries
    based on the app.current_user_id session variable set by init_rls_middleware().

    Args:
        db_engine: SQLAlchemy engine instance
        app: Flask application instance (for logging)

    Example policies created:
        - Items: Only show items where user_id matches current session user
        - Routines: Only show routines where user_id matches current session user
        - ChordCharts: Only show chord charts where user_id matches current session user
    """
    policies = [
        # Items table RLS
        """
        ALTER TABLE items ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS items_isolation_policy ON items;
        CREATE POLICY items_isolation_policy ON items
            USING (
                user_id = current_setting('app.current_user_id', true)::integer
                OR current_setting('app.current_user_id', true) IS NULL
            );
        """,

        # Routines table RLS
        """
        ALTER TABLE routines ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS routines_isolation_policy ON routines;
        CREATE POLICY routines_isolation_policy ON routines
            USING (
                user_id = current_setting('app.current_user_id', true)::integer
                OR current_setting('app.current_user_id', true) IS NULL
            );
        """,

        # Chord charts table RLS
        """
        ALTER TABLE chord_charts ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS chord_charts_isolation_policy ON chord_charts;
        CREATE POLICY chord_charts_isolation_policy ON chord_charts
            USING (
                user_id = current_setting('app.current_user_id', true)::integer
                OR current_setting('app.current_user_id', true) IS NULL
            );
        """,
    ]

    app.logger.info("Setting up PostgreSQL RLS policies...")
    app.logger.warning("PostgreSQL RLS is experimental - test thoroughly before production use")

    with db_engine.connect() as conn:
        for policy_sql in policies:
            try:
                conn.execute(text(policy_sql))
                conn.commit()
                app.logger.info("RLS policy created successfully")
            except Exception as e:
                app.logger.error(f"Failed to create RLS policy: {e}")
                conn.rollback()

    app.logger.info("PostgreSQL RLS policies configured")
