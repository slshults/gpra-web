"""
Flask-AppBuilder Admin Interface Configuration
"""
from flask import Flask
from flask_appbuilder import AppBuilder, IndexView
from flask_appbuilder.models.sqla.interface import SQLAInterface
from flask_appbuilder import ModelView
from flask_sqlalchemy import SQLAlchemy

# Import our existing models
from app.models import Item, Routine, RoutineItem, ChordChart, CommonChord, ActiveRoutine


class AdminIndexView(IndexView):
    """Custom IndexView to mount admin interface at /admin/"""
    route_base = '/admin'


def init_admin(app: Flask, db_session):
    """
    Initialize Flask-AppBuilder admin interface.

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
    db = SQLAlchemy(app)

    # Mount admin interface at /admin/ using custom IndexView
    appbuilder = AppBuilder(app, db.session, indexview=AdminIndexView)

    # Define admin views for each model
    # Each ModelView must set route_base to be under /admin/ prefix

    class ItemModelView(ModelView):
        datamodel = SQLAInterface(Item)
        route_base = '/admin/items'
        list_columns = ['id', 'item_id', 'title', 'duration', 'tuning', 'created_at']
        show_columns = ['id', 'item_id', 'title', 'notes', 'duration',
                       'description', 'order', 'tuning', 'songbook',
                       'created_at', 'updated_at']
        search_columns = ['title', 'item_id', 'notes', 'description']

    class RoutineModelView(ModelView):
        datamodel = SQLAInterface(Routine)
        route_base = '/admin/routines'
        list_columns = ['id', 'name', 'created_at', 'order']
        show_columns = ['id', 'name', 'created_at', 'order']
        search_columns = ['name']

    class RoutineItemModelView(ModelView):
        datamodel = SQLAInterface(RoutineItem)
        route_base = '/admin/routineitems'
        list_columns = ['id', 'routine_id', 'item_id', 'order', 'completed']
        show_columns = ['id', 'routine_id', 'item_id', 'order', 'completed', 'created_at']

    class ChordChartModelView(ModelView):
        datamodel = SQLAInterface(ChordChart)
        route_base = '/admin/chordcharts'
        list_columns = ['chord_id', 'item_id', 'title', 'section_label', 'created_at']
        show_columns = ['chord_id', 'item_id', 'title', 'chord_data',
                       'created_at', 'order_col']
        search_columns = ['title', 'item_id']

    class CommonChordModelView(ModelView):
        datamodel = SQLAInterface(CommonChord)
        route_base = '/admin/commonchords'
        list_columns = ['id', 'name', 'type', 'created_at']
        show_columns = ['id', 'type', 'name', 'chord_data', 'created_at', 'order_col']
        search_columns = ['name', 'type']

    class ActiveRoutineModelView(ModelView):
        datamodel = SQLAInterface(ActiveRoutine)
        route_base = '/admin/activeroutine'
        list_columns = ['id', 'routine_id', 'updated_at']
        show_columns = ['id', 'routine_id', 'updated_at']

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

    return appbuilder
