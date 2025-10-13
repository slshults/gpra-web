"""
Data layer abstraction for gradual migration from Sheets to PostgreSQL.
Allows switching between data sources via environment variable.

RLS Integration:
    This data layer automatically enforces Row-Level Security when in PostgreSQL mode.
    All queries are filtered by the current user's ID, and all create operations
    automatically set the user_id field.
"""
import os
import logging
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import both data access methods
try:
    from app import sheets
    SHEETS_AVAILABLE = True
except ImportError:
    SHEETS_AVAILABLE = False
    logging.warning("Sheets module not available")

try:
    from app.services.items import ItemService
    from app.services.chord_charts import ChordChartService
    from app.services.common_chords import CommonChordService
    from app.services.routines import routine_service
    from app.repositories.items import ItemRepository
    from app.database import DatabaseTransaction
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False
    logging.warning("PostgreSQL services not available")

# Import RLS helpers
try:
    from app.middleware.rls import get_current_user_id, set_user_id_on_create
    RLS_AVAILABLE = True
except ImportError:
    RLS_AVAILABLE = False
    logging.warning("RLS middleware not available")

# Configuration
USE_POSTGRES = os.getenv('USE_POSTGRES', 'False').lower() == 'true'
MIGRATION_MODE = os.getenv('MIGRATION_MODE', 'sheets')  # sheets, postgres, dual

class DataLayer:
    """Unified data access layer supporting both Sheets and PostgreSQL."""
    
    def __init__(self):
        self.mode = MIGRATION_MODE
        logging.info(f"DataLayer initialized in {self.mode} mode")
        
        if self.mode == 'postgres' and not POSTGRES_AVAILABLE:
            logging.error("PostgreSQL mode requested but not available, falling back to sheets")
            self.mode = 'sheets'
        elif self.mode == 'sheets' and not SHEETS_AVAILABLE:
            logging.error("Sheets mode requested but not available, falling back to postgres")
            self.mode = 'postgres'
    
    def _get_db_id_from_item_id(self, item_id) -> Optional[int]:
        """Convert ItemID (Column B from sheets) to database primary key (id column)."""
        if self.mode != 'postgres':
            return item_id  # In sheets mode, just pass through

        try:
            from sqlalchemy import text
            # Ensure item_id is always treated as string since that's how it's stored in DB
            item_id_str = str(item_id)
            with DatabaseTransaction() as db:
                result = db.execute(text('SELECT id FROM items WHERE item_id = :item_id'), {'item_id': item_id_str}).fetchone()
                if result:
                    logging.debug(f"Found database ID {result[0]} for ItemID '{item_id_str}'")
                    return result[0]  # Return database primary key
                logging.warning(f"No database record found for ItemID '{item_id_str}'")
                return None
        except Exception as e:
            logging.error(f"Error converting item_id {item_id} to db_id: {e}")
            return None
    
    # Items API
    def get_all_items(self) -> List[Dict[str, Any]]:
        """Get all items for the current user (RLS-filtered in postgres mode)."""
        if self.mode == 'postgres':
            service = ItemService()
            items = service.get_all_items()

            # RLS filtering happens at repository level, but log for debugging
            if RLS_AVAILABLE:
                user_id = get_current_user_id()
                logging.debug(f"DataLayer.get_all_items: Retrieved items for user_id={user_id}")

            return items
        else:
            return sheets.get_all_items()
    
    def add_item(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new item (automatically sets user_id in postgres mode)."""
        if self.mode == 'postgres':
            # Automatically set user_id on create (RLS)
            if RLS_AVAILABLE:
                item_data = set_user_id_on_create(item_data)

            service = ItemService()
            return service.create_item(item_data)
        else:
            return sheets.add_item(item_data)
    
    def update_item(self, item_id: int, item_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            # Convert ItemID to database primary key
            db_id = self._get_db_id_from_item_id(item_id)
            if db_id is None:
                return None
            service = ItemService()
            return service.update_item(db_id, item_data)
        else:
            return sheets.update_item(item_id, item_data)
    
    def delete_item(self, item_id: int) -> bool:
        if self.mode == 'postgres':
            # Convert ItemID to database primary key
            db_id = self._get_db_id_from_item_id(item_id)
            if db_id is None:
                return False
            service = ItemService()
            return service.delete_item(db_id)
        else:
            return sheets.delete_item(item_id)
    
    def update_items_order(self, items: List[Dict[str, Any]]) -> bool:
        if self.mode == 'postgres':
            service = ItemService()
            return service.update_items_order(items)
        else:
            return sheets.update_items_order(items)
    
    def get_item_notes(self, item_id: int) -> Dict[str, Any]:
        """Get notes for a specific item."""
        if self.mode == 'postgres':
            service = ItemService()
            # Convert Google Sheets ItemID to database ID
            db_id = self._get_db_id_from_item_id(item_id)
            if not db_id:
                return {'error': 'Item not found'}
            
            item = service.get_item_by_id(db_id)
            if not item:
                return {'error': 'Item not found'}
            
            return {'notes': item.get('D', '')}  # Column D is notes
        else:
            # Use sheets implementation
            return sheets.get_item_notes(item_id)
    
    def save_item_notes(self, item_id: int, notes: str) -> Dict[str, Any]:
        """Save notes for a specific item.""" 
        if self.mode == 'postgres':
            service = ItemService()
            # Convert Google Sheets ItemID to database ID
            db_id = self._get_db_id_from_item_id(item_id)
            if not db_id:
                return {'error': 'Item not found'}
            
            success = service.update_item_notes(db_id, notes)
            if success:
                return {'success': True}
            else:
                return {'error': 'Failed to save notes'}
        else:
            # Use sheets implementation
            return sheets.save_item_notes(item_id, notes)
    
    # Chord Charts API
    def get_chord_charts_for_item(self, item_id: int) -> List[Dict[str, Any]]:
        """Get chord charts for an item (RLS-filtered in postgres mode)."""
        if self.mode == 'postgres':
            # Handle comma-separated ItemIDs - search for ItemIDs that contain this ID
            from sqlalchemy import text
            from app.database import DatabaseTransaction

            item_id_str = str(item_id)
            charts = []

            with DatabaseTransaction() as db:
                # Build RLS-aware query
                user_filter = ''
                params = {
                    'exact_id': item_id_str,
                    'pattern1': f'{item_id_str},%',  # "107, 61"
                    'pattern2': f'%, {item_id_str}',  # "61, 107"
                    'pattern3': f'%, {item_id_str},%'  # "61, 107, 45"
                }

                # Add user_id filter if RLS is available
                if RLS_AVAILABLE:
                    user_id = get_current_user_id()
                    if user_id:
                        user_filter = 'AND (user_id = :user_id OR user_id IS NULL)'
                        params['user_id'] = user_id
                        logging.debug(f"DataLayer.get_chord_charts_for_item: Filtering by user_id={user_id}")

                # Look for exact match first, then comma-separated matches
                result = db.execute(text(f'''
                    SELECT chord_id, item_id, title, chord_data, created_at, order_col
                    FROM chord_charts
                    WHERE (item_id = :exact_id
                       OR item_id LIKE :pattern1
                       OR item_id LIKE :pattern2
                       OR item_id LIKE :pattern3)
                    {user_filter}
                    ORDER BY order_col
                '''), params).fetchall()
                
                for row in result:
                    # Parse chord_data JSON from database
                    chord_data = row[3] if row[3] else {}
                    
                    # Return proper frontend format (flattened format matching repository)
                    chart = {
                        'id': str(row[0]),  # chord_id as string to match repository format
                        'title': row[2] or '',  # chord name
                        'order': row[5] if row[5] is not None else 0,  # order_col
                        'createdAt': row[4].isoformat() if row[4] else '',
                        'itemId': row[1]  # Keep for reference but not used in frontend
                    }

                    # Flatten chord_data properties to top level (matching repository format)
                    if isinstance(chord_data, dict):
                        # Clean finger data - remove None values and filter out open strings (fret 0)
                        raw_fingers = chord_data.get('fingers', [])
                        clean_fingers = []
                        for finger in raw_fingers:
                            if isinstance(finger, list) and len(finger) >= 2:
                                # Filter out None values and keep only valid numbers
                                clean_finger = [x for x in finger if x is not None]
                                # Only include fretted positions (fret > 0), skip open strings (fret 0)
                                if len(clean_finger) >= 2 and clean_finger[1] > 0:
                                    clean_fingers.append(clean_finger)
                            else:
                                clean_fingers.append(finger)  # Keep non-list items as-is

                        chart.update({
                            'fingers': clean_fingers,
                            'barres': chord_data.get('barres', []),
                            'tuning': chord_data.get('tuning', 'EADGBE'),
                            'capo': chord_data.get('capo', 0),
                            'startingFret': chord_data.get('startingFret', 1),
                            'numFrets': chord_data.get('numFrets', 5),
                            'numStrings': chord_data.get('numStrings', 6),
                            'openStrings': chord_data.get('openStrings', []),
                            'mutedStrings': chord_data.get('mutedStrings', []),
                            'sectionId': chord_data.get('sectionId', ''),
                            'sectionLabel': chord_data.get('sectionLabel', ''),
                            'sectionRepeatCount': chord_data.get('sectionRepeatCount', ''),
                            'hasLineBreakAfter': chord_data.get('hasLineBreakAfter', False)
                        })
                    
                    charts.append(chart)
            
            return charts
        else:
            return sheets.get_chord_charts_for_item(item_id)
    
    def batch_get_chord_charts(self, item_ids: List[int]) -> Dict[str, List[Dict[str, Any]]]:
        """Get chord charts for multiple items in a single operation (RLS-filtered in postgres mode)."""
        if self.mode == 'postgres':
            from sqlalchemy import text
            from app.database import DatabaseTransaction

            result = {}

            with DatabaseTransaction() as db:
                for item_id in item_ids:
                    item_id_str = str(item_id)
                    charts = []

                    # Build RLS-aware query
                    user_filter = ''
                    params = {
                        'exact_id': item_id_str,
                        'pattern1': f'{item_id_str},%',  # "107, 61"
                        'pattern2': f'%, {item_id_str},%',  # "23, 107, 61"
                        'pattern3': f'%, {item_id_str}'  # "23, 107"
                    }

                    # Add user_id filter if RLS is available
                    if RLS_AVAILABLE:
                        user_id = get_current_user_id()
                        if user_id:
                            user_filter = 'AND (user_id = :user_id OR user_id IS NULL)'
                            params['user_id'] = user_id

                    # Look for exact match first, then comma-separated matches
                    rows = db.execute(text(f'''
                        SELECT chord_id, item_id, title, chord_data, created_at, order_col
                        FROM chord_charts
                        WHERE (item_id = :exact_id
                           OR item_id LIKE :pattern1
                           OR item_id LIKE :pattern2
                           OR item_id LIKE :pattern3)
                        {user_filter}
                        ORDER BY order_col
                    '''), params).fetchall()
                    
                    for row in rows:
                        chart = {
                            'id': str(row[0]),  # chord_id as string to match repository format
                            'itemId': item_id,  # Use the requested item_id, not the comma-separated string
                            'title': row[2],
                            'createdAt': row[4] if row[4] else '',
                            'order': row[5]
                        }

                        # Parse chord_data JSON safely
                        chord_data = row[3]
                        if isinstance(chord_data, str):
                            import json
                            try:
                                chord_data = json.loads(chord_data)
                            except json.JSONDecodeError:
                                chord_data = {}
                        elif not isinstance(chord_data, dict):
                            chord_data = {}

                        # Flatten chord_data properties to top level (matching repository format)
                        if chord_data:
                            # Clean finger data - remove None values and filter out open strings (fret 0)
                            raw_fingers = chord_data.get('fingers', [])
                            clean_fingers = []
                            for finger in raw_fingers:
                                if isinstance(finger, list) and len(finger) >= 2:
                                    # Filter out None values and keep only valid numbers
                                    clean_finger = [x for x in finger if x is not None]
                                    # Only include fretted positions (fret > 0), skip open strings (fret 0)
                                    if len(clean_finger) >= 2 and clean_finger[1] > 0:
                                        clean_fingers.append(clean_finger)
                                else:
                                    clean_fingers.append(finger)  # Keep non-list items as-is

                            chart.update({
                                'fingers': clean_fingers,
                                'barres': chord_data.get('barres', []),
                                'tuning': chord_data.get('tuning', 'EADGBE'),
                                'capo': chord_data.get('capo', 0),
                                'startingFret': chord_data.get('startingFret', 1),
                                'numFrets': chord_data.get('numFrets', 5),
                                'numStrings': chord_data.get('numStrings', 6),
                                'openStrings': chord_data.get('openStrings', []),
                                'mutedStrings': chord_data.get('mutedStrings', []),
                                'sectionId': chord_data.get('sectionId', ''),
                                'sectionLabel': chord_data.get('sectionLabel', ''),
                                'sectionRepeatCount': chord_data.get('sectionRepeatCount', ''),
                                'hasLineBreakAfter': chord_data.get('hasLineBreakAfter', False)
                            })
                        
                        charts.append(chart)
                    
                    # Store charts for this item_id (as string for frontend compatibility)
                    result[str(item_id)] = charts
            
            return result
        else:
            return sheets.batch_get_chord_charts(item_ids)
    
    def add_chord_chart(self, item_id: int, chart_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new chord chart (automatically sets user_id in postgres mode)."""
        if self.mode == 'postgres':
            # Automatically set user_id on create (RLS)
            if RLS_AVAILABLE:
                chart_data = set_user_id_on_create(chart_data)

            # Use ItemID as string directly (no conversion needed)
            service = ChordChartService()
            return service.create_chord_chart(str(item_id), chart_data)
        else:
            return sheets.add_chord_chart(item_id, chart_data)
    
    def batch_add_chord_charts(self, item_id: int, chord_charts_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Batch create chord charts (automatically sets user_id in postgres mode)."""
        if self.mode == 'postgres':
            # Automatically set user_id on each chart (RLS)
            if RLS_AVAILABLE:
                chord_charts_data = [set_user_id_on_create(chart) for chart in chord_charts_data]

            # Use ItemID as string directly (no conversion needed)
            service = ChordChartService()
            return service.batch_create(str(item_id), chord_charts_data)
        else:
            return sheets.batch_add_chord_charts(item_id, chord_charts_data)
    
    def update_chord_chart(self, chart_id: int, chart_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            service = ChordChartService()
            return service.update_chord_chart(chart_id, chart_data)
        else:
            return sheets.update_chord_chart(chart_id, chart_data)
    
    def delete_chord_chart(self, chart_id: int) -> bool:
        if self.mode == 'postgres':
            service = ChordChartService()
            return service.delete_chord_chart(chart_id)
        else:
            return sheets.delete_chord_chart(chart_id)

    def delete_chord_chart_from_item(self, item_id: int, chart_id: int) -> bool:
        """Delete a chord chart from a specific item (handles comma-separated sharing properly)"""
        if self.mode == 'postgres':
            service = ChordChartService()
            return service.delete_chord_chart_from_item(str(item_id), chart_id)
        else:
            # For sheets mode, context matters - need to implement sharing logic
            return sheets.delete_chord_chart_from_item(item_id, chart_id)
    
    def batch_delete_chord_charts(self, chord_ids: List[int], item_id: str = None) -> Dict[str, Any]:
        """Delete multiple chord charts by IDs in a single transaction.

        Args:
            chord_ids: List of chord chart IDs to delete
            item_id: Optional item context - if provided, uses sharing-aware deletion
        """
        if self.mode == 'postgres':
            if item_id:
                # Use sharing-aware deletion when item context is provided
                service = ChordChartService()
                deleted_count = 0

                for chord_id in chord_ids:
                    if service.delete_chord_chart_from_item(item_id, chord_id):
                        deleted_count += 1

                return {
                    "success": True,
                    "deleted": chord_ids[:deleted_count],  # IDs that were processed
                    "deleted_count": deleted_count
                }
            else:
                # Legacy behavior: complete deletion when no item context
                from app.repositories.chord_charts import ChordChartRepository
                with DatabaseTransaction() as db:
                    repo = ChordChartRepository(db)
                    deleted_count = repo.batch_delete(chord_ids)
                    return {
                        "success": True,
                        "deleted": chord_ids[:deleted_count],  # IDs that were actually deleted
                        "deleted_count": deleted_count
                    }
        else:
            return sheets.batch_delete_chord_charts(chord_ids)
    
    def update_chord_charts_order(self, item_id: int, chord_charts: List[Dict[str, Any]]) -> bool:
        if self.mode == 'postgres':
            service = ChordChartService()
            return service.update_order(str(item_id), chord_charts)
        else:
            return sheets.update_chord_charts_order(item_id, chord_charts)
    
    # Routines API
    def get_all_routines(self) -> List[Dict[str, Any]]:
        """Get all routines for the current user (RLS-filtered in postgres mode)."""
        if self.mode == 'postgres':
            routines = routine_service.get_all_routines()

            # RLS filtering happens at repository level, but log for debugging
            if RLS_AVAILABLE:
                user_id = get_current_user_id()
                logging.debug(f"DataLayer.get_all_routines: Retrieved routines for user_id={user_id}")

            return routines
        else:
            return sheets.get_all_routines()
    
    def create_routine(self, routine_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new routine (automatically sets user_id in postgres mode)."""
        if self.mode == 'postgres':
            # Automatically set user_id on create (RLS)
            if RLS_AVAILABLE:
                routine_data = set_user_id_on_create(routine_data)

            return routine_service.create_routine(routine_data)
        else:
            return sheets.add_routine(routine_data)
    
    def update_routine(self, routine_id: int, routine_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            return routine_service.update_routine(routine_id, routine_data)
        else:
            return sheets.update_routine(routine_id, routine_data)
    
    def delete_routine(self, routine_id: int) -> bool:
        if self.mode == 'postgres':
            return routine_service.delete_routine(routine_id)
        else:
            return sheets.delete_routine(routine_id)
    
    def get_routine_with_items(self, routine_id: int) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            return routine_service.get_routine_with_items(routine_id)
        else:
            return sheets.get_routine_with_items(routine_id)
    
    def get_routine_items(self, routine_id: int) -> List[Dict[str, Any]]:
        if self.mode == 'postgres':
            return routine_service.get_routine_items(routine_id)
        else:
            return sheets.get_routine_items(routine_id)
    
    def add_item_to_routine(self, routine_id: int, item_id: int, order: int = None) -> Dict[str, Any]:
        if self.mode == 'postgres':
            return routine_service.add_item_to_routine(routine_id, item_id, order)
        else:
            return sheets.add_item_to_routine(routine_id, item_id, order)
    
    def remove_item_from_routine(self, routine_id: int, item_id: int) -> bool:
        if self.mode == 'postgres':
            return routine_service.remove_item_from_routine(routine_id, item_id)
        else:
            return sheets.remove_item_from_routine(routine_id, item_id)

    def remove_routine_item_by_id(self, routine_id: int, routine_item_id: int) -> bool:
        if self.mode == 'postgres':
            return routine_service.remove_routine_item_by_id(routine_id, routine_item_id)
        else:
            # For sheets mode, the routine_item_id would be the routine entry ID
            return sheets.remove_item_from_routine(routine_id, routine_item_id)
    
    def update_routine_items_order(self, routine_id: int, items: List[Dict[str, Any]]) -> bool:
        if self.mode == 'postgres':
            return routine_service.update_routine_items_order(routine_id, items)
        else:
            return sheets.update_routine_items_order(routine_id, items)

    def update_routines_order(self, routines: List[Dict[str, Any]]) -> bool:
        if self.mode == 'postgres':
            return routine_service.update_routines_order(routines)
        else:
            return sheets.update_routines_order(routines)

    def update_routine_item(self, routine_id: int, routine_item_id: str, item_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            return routine_service.update_routine_item(routine_id, routine_item_id, item_data)
        else:
            return sheets.update_routine_item(routine_id, routine_item_id, item_data)

    def mark_item_complete(self, routine_id: int, routine_item_id: int, completed: bool = True) -> bool:
        if self.mode == 'postgres':
            return routine_service.mark_item_complete(routine_id, routine_item_id, completed)
        else:
            return sheets.mark_routine_item_complete(routine_id, routine_item_id, completed)
    
    def reset_routine_progress(self, routine_id: int) -> bool:
        if self.mode == 'postgres':
            return routine_service.reset_routine_progress(routine_id)
        else:
            return sheets.reset_routine_progress(routine_id)
    
    # Active routine management
    def get_active_routine(self) -> Optional[Dict[str, Any]]:
        if self.mode == 'postgres':
            return routine_service.get_active_routine()
        else:
            return sheets.get_active_routine()
    
    def set_active_routine(self, routine_id: int) -> bool:
        if self.mode == 'postgres':
            return routine_service.set_active_routine(routine_id)
        else:
            return sheets.set_active_routine(routine_id)
    
    def clear_active_routine(self) -> bool:
        if self.mode == 'postgres':
            return routine_service.clear_active_routine()
        else:
            return sheets.clear_active_routine()
    
    # Statistics and utilities
    def get_stats(self) -> Dict[str, Any]:
        """Get combined statistics about items, chord charts, and routines."""
        if self.mode == 'postgres':
            item_service = ItemService()
            chord_service = ChordChartService()
            
            item_stats = item_service.get_item_stats()
            chord_stats = chord_service.get_chart_stats()
            routine_stats = routine_service.get_stats()
            
            return {
                **item_stats,
                **chord_stats,
                **routine_stats,
                'data_source': 'postgresql'
            }
        else:
            # For Sheets, we'd need to implement similar stats
            items = sheets.get_all_items()
            routines = sheets.get_all_routines()
            return {
                'total_items': len(items),
                'total_routines': len(routines),
                'data_source': 'google_sheets'
            }
    
    def get_mode_info(self) -> Dict[str, Any]:
        """Get current mode and availability information."""
        return {
            "mode": self.mode,
            "postgres_available": POSTGRES_AVAILABLE,
            "sheets_available": SHEETS_AVAILABLE,
            "use_postgres_env": USE_POSTGRES,
            "migration_mode_env": MIGRATION_MODE
        }
    
    def copy_chord_charts_to_items(self, source_item_id: str, target_item_ids: List[str]) -> Dict[str, Any]:
        """Copy chord charts from one item to multiple target items."""
        if self.mode == 'postgres':
            # PostgreSQL implementation using ChordChartService
            try:
                chord_service = ChordChartService()
                return chord_service.copy_chord_charts_to_items(source_item_id, target_item_ids)
            except Exception as e:
                logging.error(f"PostgreSQL copy_chord_charts_to_items failed: {e}")
                raise
        else:
            # Fallback to sheets implementation
            return sheets.copy_chord_charts_to_items(source_item_id, target_item_ids)

    def get_common_chords_efficiently(self) -> List[Dict[str, Any]]:
        """Get all common chord charts efficiently for autocreate functionality."""
        if self.mode == 'postgres':
            # PostgreSQL implementation using CommonChordService
            try:
                common_chord_service = CommonChordService()
                return common_chord_service.get_all_for_autocreate()
            except Exception as e:
                logging.error(f"PostgreSQL get_common_chords_efficiently failed: {e}")
                return []
        else:
            # Fallback to sheets implementation
            return sheets.get_common_chords_efficiently()

# Global instance
data_layer = DataLayer()