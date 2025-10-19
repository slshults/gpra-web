"""
Flask-AppBuilder Admin Interface Configuration
"""
from flask import Flask
from flask_appbuilder import AppBuilder, IndexView
from flask_appbuilder.models.sqla.interface import SQLAInterface
from flask_appbuilder import ModelView
from flask_sqlalchemy import SQLAlchemy

# Import our existing models AND Base
from app.models import Item, Routine, RoutineItem, ChordChart, CommonChord, ActiveRoutine, Subscription, Base

# Import custom security manager
from app.security import CustomSecurityManager, CustomAuthDBView


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
        'postgresql://gpra:^66*B^mzg6Y6e#@localhost:5432/gpra_dev')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = app.config.get('SECRET_KEY',
        '82a393ed5a3dbe58b0e03785215cfcb757f7d393ecde90d4ef25d6b46b28d819')

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

    class ItemModelView(ModelView):
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

    class RoutineModelView(ModelView):
        datamodel = SQLAInterface(Routine)
        route_base = '/admin/routines'
        list_columns = ['id', 'name', 'user_id', 'username', 'created_at', 'order']
        show_columns = ['id', 'name', 'user_id', 'username', 'created_at', 'order']
        search_columns = ['name', 'user_id']
        label_columns = {
            'username': 'Username',
            'user_id': 'User ID'
        }

    class RoutineItemModelView(ModelView):
        datamodel = SQLAInterface(RoutineItem)
        route_base = '/admin/routineitems'
        list_columns = ['id', 'routine_id', 'item_id', 'order', 'completed']
        show_columns = ['id', 'routine_id', 'item_id', 'order', 'completed', 'created_at']

    class ChordChartModelView(ModelView):
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

    class CommonChordModelView(ModelView):
        datamodel = SQLAInterface(CommonChord)
        route_base = '/admin/commonchords'
        list_columns = ['id', 'name', 'type', 'created_at']
        show_columns = ['id', 'type', 'name', 'chord_data', 'created_at', 'order_col']
        search_columns = ['name', 'type']
        label_columns = {
            'chord_data': 'Chord Data (JSON)'
        }

    class ActiveRoutineModelView(ModelView):
        datamodel = SQLAInterface(ActiveRoutine)
        route_base = '/admin/activeroutine'
        list_columns = ['id', 'routine_id', 'updated_at']
        show_columns = ['id', 'routine_id', 'updated_at']

    class SubscriptionModelView(ModelView):
        datamodel = SQLAInterface(Subscription)
        route_base = '/admin/subscriptions'
        list_columns = ['id', 'user_id', 'username', 'email', 'tier', 'status', 'mrr', 'created_at']
        show_columns = ['id', 'user_id', 'username', 'email', 'stripe_subscription_id', 'stripe_price_id',
                       'tier', 'status', 'mrr', 'current_period_start',
                       'current_period_end', 'cancel_at_period_end',
                       'created_at', 'updated_at']
        search_columns = ['tier', 'status']
        label_columns = {
            'username': 'Username',
            'email': 'Email'
        }
        base_order = ('id', 'desc')

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
    appbuilder.add_view(
        SubscriptionModelView,
        "Subscriptions",
        icon="fa-credit-card",
        category="User Management"
    )

    return appbuilder
