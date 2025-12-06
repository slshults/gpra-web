"""
Flask-AppBuilder Admin Interface Configuration
"""
from flask import Flask, flash
from flask_appbuilder import AppBuilder, IndexView
from flask_appbuilder.models.sqla.interface import SQLAInterface
from flask_appbuilder import ModelView
from flask_sqlalchemy import SQLAlchemy
import logging

# Import our existing models AND Base
from app.models import Item, Routine, RoutineItem, ChordChart, CommonChord, ActiveRoutine, Subscription, Base

# Import custom security manager
from app.security import CustomSecurityManager, CustomAuthDBView

logger = logging.getLogger(__name__)


class BaseModelView(ModelView):
    """
    Base ModelView with LazyString serialization fix for Redis sessions.

    Flask-AppBuilder uses lazy_gettext for flash messages, which can't be
    serialized by Flask-Session with Redis backend. This class wraps all
    flash messages in the _delete method.
    """

    def _delete(self, pk):
        """
        Override _delete to wrap flash messages in str() for Redis compatibility.

        This is called by the delete route handler before deletion.
        """
        item = self.datamodel.get(pk)
        if not item:
            flash(str("Record not found"), "danger")
            return False

        # Call pre_delete if it exists (e.g., for user validation)
        try:
            if hasattr(self, 'pre_delete'):
                self.pre_delete(item)
        except Exception as e:
            logger.error(f"pre_delete failed: {e}")
            # pre_delete should have already set a flash message
            return False

        # Perform deletion
        try:
            self.datamodel.delete(item)
            flash(str("Record deleted successfully"), "success")

            # Call post_delete if it exists
            if hasattr(self, 'post_delete'):
                self.post_delete(item)

            return True
        except Exception as e:
            logger.exception(f"Delete failed: {e}")
            flash(str(f"Delete failed: {e}"), "danger")
            return False


class AdminIndexView(IndexView):
    """Custom IndexView to mount admin interface at /admin/"""
    route_base = '/admin'


def init_admin(app: Flask, db_session):
    """
    Initialize Flask-AppBuilder admin interface with custom security.

    Args:
        app: Flask application instance
        db_session: SQLAlchemy session factory (SessionLocal from database.py)
    """
    # Configure Flask-AppBuilder
    app.config['SQLALCHEMY_DATABASE_URI'] = app.config.get('DATABASE_URL',
        'postgresql://gpra:***REMOVED***@localhost:5432/gpra_dev')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = app.config.get('SECRET_KEY',
        '***REMOVED***')

    # Flask-AppBuilder requires its own SQLAlchemy instance
    # CRITICAL: Our models.py now imports FAB's Base, so foreign keys to ab_user work
    db = SQLAlchemy(app)

    # Mount admin interface at /admin/ with custom security manager
    appbuilder = AppBuilder(
        app,
        db.session,
        indexview=AdminIndexView,
        security_manager_class=CustomSecurityManager
    )

    # Define admin views for each model
    # Each ModelView must set route_base to be under /admin/ prefix

    class ItemModelView(BaseModelView):
        datamodel = SQLAInterface(Item)
        route_base = '/admin/items'
        list_columns = ['id', 'item_id', 'title', 'duration', 'tuning', 'user_id', 'username', 'created_at']
        show_columns = ['id', 'item_id', 'title', 'notes', 'duration',
                       'description', 'order', 'tuning', 'songbook',
                       'user_id', 'username', 'created_at', 'updated_at']
        search_columns = ['title', 'item_id', 'notes', 'description', 'user_id']
        label_columns = {
            'username': 'Username',
            'user_id': 'User ID'
        }
        # Exclude 'username' from sortable columns (it's a @property, not a DB column)
        order_columns = ['id', 'item_id', 'title', 'duration', 'tuning', 'user_id', 'created_at']

        # Use column_formatters for display-only properties instead of model @property
        # This prevents FAB from trying to populate these fields during edit operations
        column_formatters = {
            'username': lambda view, context, model, name: model.username
        }

    class RoutineModelView(BaseModelView):
        datamodel = SQLAInterface(Routine)
        route_base = '/admin/routines'
        list_columns = ['id', 'name', 'user_id', 'username', 'created_at', 'order']
        show_columns = ['id', 'name', 'user_id', 'username', 'created_at', 'order']
        search_columns = ['name', 'user_id']
        label_columns = {
            'username': 'Username',
            'user_id': 'User ID'
        }
        # Exclude 'username' from sortable columns (it's a @property, not a DB column)
        order_columns = ['id', 'name', 'user_id', 'created_at', 'order']

        # Use column_formatters for display-only properties instead of model @property
        # This prevents FAB from trying to populate these fields during edit operations
        column_formatters = {
            'username': lambda view, context, model, name: model.username
        }

    class RoutineItemModelView(BaseModelView):
        datamodel = SQLAInterface(RoutineItem)
        route_base = '/admin/routineitems'
        list_columns = ['id', 'routine_id', 'item_id', 'order', 'completed']
        show_columns = ['id', 'routine_id', 'item_id', 'order', 'completed', 'created_at']

    class ChordChartModelView(BaseModelView):
        datamodel = SQLAInterface(ChordChart)
        route_base = '/admin/chordcharts'
        list_columns = ['chord_id', 'item_id', 'title', 'section_label', 'user_id', 'username', 'created_at']
        show_columns = ['chord_id', 'item_id', 'title', 'chord_data', 'user_id', 'username', 'created_at', 'order_col']
        search_columns = ['title', 'item_id', 'user_id']
        label_columns = {
            'chord_data': 'Chord Data (JSON)',
            'username': 'Username',
            'user_id': 'User ID'
        }
        # Exclude 'username' and 'section_label' from sortable columns (they're @property, not DB columns)
        order_columns = ['chord_id', 'item_id', 'title', 'user_id', 'created_at']

        # Use column_formatters for display-only properties instead of model @property
        # This prevents FAB from trying to populate these fields during edit operations
        column_formatters = {
            'username': lambda view, context, model, name: model.username,
            'section_label': lambda view, context, model, name: model.section_label
        }

    class CommonChordModelView(BaseModelView):
        datamodel = SQLAInterface(CommonChord)
        route_base = '/admin/commonchords'
        list_columns = ['id', 'name', 'type', 'created_at']
        show_columns = ['id', 'type', 'name', 'chord_data', 'created_at', 'order_col']
        search_columns = ['name', 'type']
        label_columns = {
            'chord_data': 'Chord Data (JSON)'
        }

    class ActiveRoutineModelView(BaseModelView):
        datamodel = SQLAInterface(ActiveRoutine)
        route_base = '/admin/activeroutine'
        list_columns = ['id', 'routine_id', 'updated_at']
        show_columns = ['id', 'routine_id', 'updated_at']

    class SubscriptionModelView(BaseModelView):
        datamodel = SQLAInterface(Subscription)
        route_base = '/admin/subscriptions'
        list_columns = ['id', 'user_id', 'username', 'email', 'tier', 'status', 'is_complimentary', 'mrr', 'created_at']
        show_columns = ['id', 'user_id', 'username', 'email', 'stripe_subscription_id', 'stripe_price_id',
                       'tier', 'status', 'is_complimentary', 'complimentary_reason', 'mrr', 'current_period_start',
                       'current_period_end', 'cancel_at_period_end',
                       'created_at', 'updated_at']
        # Note: stripe_subscription_id and stripe_price_id removed - they have UNIQUE constraints
        # and FAB sends empty strings which violate uniqueness. These are managed by Stripe webhooks anyway.
        edit_columns = ['tier', 'status', 'is_complimentary', 'complimentary_reason',
                       'mrr', 'current_period_start', 'current_period_end', 'cancel_at_period_end']
        add_columns = ['user_id', 'tier', 'status', 'is_complimentary', 'complimentary_reason']
        search_columns = ['tier', 'status', 'is_complimentary']
        label_columns = {
            'username': 'Username',
            'email': 'Email',
            'is_complimentary': 'Complimentary Account',
            'complimentary_reason': 'Complimentary Reason'
        }
        base_order = ('id', 'desc')
        # Exclude 'username' and 'email' from sortable columns (they're @property, not DB columns)
        order_columns = ['id', 'user_id', 'tier', 'status', 'is_complimentary', 'mrr', 'created_at']

        # Use column_formatters for display-only properties instead of model @property
        # This prevents FAB from trying to populate these fields during edit operations
        column_formatters = {
            'username': lambda view, context, model, name: model.username,
            'email': lambda view, context, model, name: model.email
        }

        def pre_update(self, item):
            """Hook called BEFORE updating a subscription - log what's about to be updated"""
            logger.info(f"SubscriptionModelView.pre_update() - About to update subscription id={item.id}, user_id={item.user_id}")
            logger.info(f"  Changes: is_complimentary={item.is_complimentary}, reason={item.complimentary_reason}")

        def post_update(self, item):
            """Hook called AFTER updating - confirm success"""
            logger.info(f"SubscriptionModelView.post_update() - Successfully updated subscription id={item.id}")

    # Register views with AppBuilder
    appbuilder.add_view(
        ItemModelView,
        "Practice Items",
        icon="fa-music",
        category="Practice Data"
    )
    appbuilder.add_view(
        RoutineModelView,
        "Routines",
        icon="fa-list",
        category="Practice Data"
    )
    appbuilder.add_view(
        RoutineItemModelView,
        "Routine Items",
        icon="fa-link",
        category="Practice Data"
    )
    appbuilder.add_view(
        ChordChartModelView,
        "Chord Charts",
        icon="fa-file-text-o",
        category="Practice Data"
    )
    appbuilder.add_view(
        CommonChordModelView,
        "Common Chords",
        icon="fa-database",
        category="Practice Data"
    )
    appbuilder.add_view(
        ActiveRoutineModelView,
        "Active Routine",
        icon="fa-play-circle",
        category="Practice Data"
    )
    # Subscriptions as top-level menu item (no category)
    appbuilder.add_view(
        SubscriptionModelView,
        "Subscriptions",
        icon="fa-credit-card"
    )

    return appbuilder
