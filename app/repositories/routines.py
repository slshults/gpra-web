from typing import List, Optional, Dict, Any
from sqlalchemy import func, and_, text
from sqlalchemy.orm import joinedload
from app.models import Routine, RoutineItem, Item, ActiveRoutine
from app.repositories.base import BaseRepository
from app.middleware.rls import filter_by_user
from app.database import DatabaseTransaction
from flask_login import current_user
import logging

class RoutineRepository(BaseRepository):
    def __init__(self, db_session=None):
        super().__init__(Routine, db_session)
    
    def get_all_ordered(self) -> List[Routine]:
        """Get all routines in physical insertion order (preserving Google Sheets sequence)."""
        # CRITICAL: Do NOT sort by order column - preserve physical insertion order from sheets migration
        # The order column contains drag-and-drop values with gaps and is for display logic only
        query = self.db.query(Routine)
        query = filter_by_user(query, Routine)
        return query.order_by(Routine.id).all()
    
    def get_sheets_format(self) -> List[Dict[str, Any]]:
        """Get all routines in Google Sheets format for API compatibility."""
        routines = self.get_all_ordered()
        return [self._to_sheets_format(routine) for routine in routines]
    
    def create_from_sheets_format(self, sheets_data: Dict[str, Any]) -> Routine:
        """Create routine from Google Sheets format data, preserving the Sheets ID."""
        routine_data = self._from_sheets_format(sheets_data)
        
        # Preserve the ID from Sheets (column A)
        sheets_id = int(sheets_data.get('A')) if sheets_data.get('A') else None
        if sheets_id:
            routine_data['id'] = sheets_id
        
        # Create routine with explicit ID
        routine = self.model_class(**routine_data)
        self.db.add(routine)
        self.db.commit()
        self.db.refresh(routine)
        return routine
    
    def update_from_sheets_format(self, routine_id: int, sheets_data: Dict[str, Any]) -> Optional[Routine]:
        """Update routine using Google Sheets format data."""
        routine_data = self._from_sheets_format(sheets_data)
        return self.update(routine_id, **routine_data)
    
    def get_with_items(self, routine_id: int) -> Optional[Routine]:
        """Get routine with routine items eagerly loaded, preserving physical insertion order."""
        # Get routine and manually load ordered routine_items to preserve insertion order
        query = self.db.query(Routine).filter(Routine.id == routine_id)
        query = filter_by_user(query, Routine)
        routine = query.first()
        if routine:
            # Manually load routine_items with explicit ordering by ID (insertion order)
            # This ensures we get the same order as the original Google Sheets physical rows
            ordered_routine_items = self.db.query(RoutineItem).options(
                joinedload(RoutineItem.item)
            ).filter(RoutineItem.routine_id == routine_id).order_by(RoutineItem.id).all()

            # Replace the lazy-loaded relationship with our ordered items
            routine.routine_items = ordered_routine_items

        return routine
    
    def get_routine_items_sheets_format(self, routine_id: int) -> List[Dict[str, Any]]:
        """Get routine items in Sheets format, preserving physical insertion order."""
        # CRITICAL: Do NOT sort by order column - preserve physical insertion order from sheets migration
        # The order column contains drag-and-drop values with gaps and is for display logic only
        routine_items = self.db.query(RoutineItem).filter(
            RoutineItem.routine_id == routine_id
        ).order_by(RoutineItem.id).all()
        
        return [self._routine_item_to_sheets_format(ri) for ri in routine_items]
    
    def add_item_to_routine(self, routine_id: int, item_id: int, order: int = None) -> RoutineItem:
        """Add an item to a routine."""
        # CRITICAL: item_id parameter is actually a Google Sheets ItemID (string like "139")
        # We need to convert it to the database primary key
        query = self.db.query(Item).filter(Item.item_id == str(item_id))
        query = filter_by_user(query, Item)
        item = query.first()
        if not item:
            raise ValueError(f"Item with ItemID '{item_id}' not found")

        # Use the database primary key for the foreign key relationship
        db_item_id = item.id
        
        if order is None:
            # Get next order number
            max_order = self.db.query(func.max(RoutineItem.order)).filter(
                RoutineItem.routine_id == routine_id
            ).scalar() or 0
            order = max_order + 1
        
        routine_item = RoutineItem(
            routine_id=routine_id,
            item_id=db_item_id,  # Use database primary key, not Google Sheets ItemID
            order=order,
            completed=False
        )
        self.db.add(routine_item)
        self.db.commit()
        self.db.refresh(routine_item)
        return routine_item
    
    def remove_item_from_routine(self, routine_id: int, item_id: int) -> bool:
        """Remove an item from a routine."""
        # CRITICAL: item_id parameter is actually a Google Sheets ItemID (string like "139")
        # We need to convert it to the database primary key
        query = self.db.query(Item).filter(Item.item_id == str(item_id))
        query = filter_by_user(query, Item)
        item = query.first()
        if not item:
            return False  # Item not found

        # Use the database primary key for the query
        db_item_id = item.id
        
        routine_item = self.db.query(RoutineItem).filter(
            and_(RoutineItem.routine_id == routine_id, RoutineItem.item_id == db_item_id)
        ).first()
        
        if routine_item:
            self.db.delete(routine_item)
            self.db.commit()
            return True
        return False

    def remove_routine_item_by_id(self, routine_id: int, routine_item_id: int) -> bool:
        """Remove a specific routine item by its ID."""
        routine_item = self.db.query(RoutineItem).filter(
            and_(RoutineItem.routine_id == routine_id, RoutineItem.id == routine_item_id)
        ).first()

        if routine_item:
            self.db.delete(routine_item)
            self.db.commit()
            return True
        return False

    def update_routine_items_order(self, routine_id: int, items: List[Dict[str, Any]]) -> bool:
        """Update routine item ordering."""
        try:
            updated_count = 0
            for item_data in items:
                routine_item_id = item_data.get('A')  # RoutineItem ID
                new_order = item_data.get('C', 0)  # Order

                if routine_item_id:
                    result = self.db.query(RoutineItem).filter(
                        and_(RoutineItem.id == int(routine_item_id),
                             RoutineItem.routine_id == routine_id)
                    ).update({RoutineItem.order: int(new_order)})
                    updated_count += result
                    logging.debug(f"Updated routine item {routine_item_id} (routine {routine_id}) order to {new_order}: {result} rows affected")

            self.db.commit()
            logging.info(f"Successfully updated {updated_count} routine item orders out of {len(items)} requested for routine {routine_id}")
            return True
        except Exception as e:
            logging.error(f"Error updating routine items order: {str(e)}")
            self.db.rollback()
            return False
    
    def update_routines_order(self, routines: List[Dict[str, Any]]) -> bool:
        """Update the order of routines in the routines list."""
        try:
            updated_count = 0
            for routine_data in routines:
                routine_id = routine_data.get('A')  # Routine ID
                new_order = routine_data.get('D', 0)  # Order (Column D)

                if routine_id:
                    query = self.db.query(Routine).filter(Routine.id == int(routine_id))
                    query = filter_by_user(query, Routine)
                    result = query.update({Routine.order: int(new_order)})
                    updated_count += result
                    logging.debug(f"Updated routine {routine_id} order to {new_order}: {result} rows affected")

            self.db.commit()
            logging.info(f"Successfully updated {updated_count} routine orders out of {len(routines)} requested")
            return True
        except Exception as e:
            logging.error(f"Error updating routines order: {str(e)}")
            self.db.rollback()
            return False

    def update_routine_item(self, routine_id: int, routine_item_id: str, item_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a specific routine item."""
        try:
            # Find the routine item by routine_id and routine_item_id (Column A)
            routine_item = self.db.query(RoutineItem).filter(
                and_(RoutineItem.routine_id == routine_id,
                     RoutineItem.id == int(routine_item_id))
            ).first()

            if not routine_item:
                return None

            # Update the routine item (only allow certain fields to be updated)
            # Preserve ID and order, allow updates to other fields like completed status, notes, etc.
            if 'D' in item_data:  # Column D is completed status
                routine_item.completed = item_data['D'] == 'TRUE'

            # Add other updateable fields as needed
            # For now, we mainly support completion status updates

            self.db.commit()

            # Return updated item in sheets format
            return self._routine_item_to_sheets_format(routine_item)
        except Exception:
            self.db.rollback()
            return None

    def mark_item_complete(self, routine_id: int, routine_item_id: int, completed: bool = True) -> bool:
        """Mark a routine item as completed or not."""
        # CRITICAL: routine_item_id parameter is the RoutineItem ID (Column A), not the Item ID
        # Frontend passes routineItem['A'] which is the RoutineItem's database primary key
        routine_item = self.db.query(RoutineItem).filter(
            and_(RoutineItem.routine_id == routine_id, RoutineItem.id == routine_item_id)
        ).first()

        if routine_item:
            routine_item.completed = completed
            self.db.commit()
            return True
        return False
    
    def reset_routine_progress(self, routine_id: int) -> bool:
        """Reset all items in a routine to not completed."""
        try:
            self.db.query(RoutineItem).filter(
                RoutineItem.routine_id == routine_id
            ).update({RoutineItem.completed: False})
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            return False
    
    # Format conversion helpers
    def _to_sheets_format(self, routine: Routine) -> Dict[str, Any]:
        """Convert SQLAlchemy Routine to Sheets API format."""
        return {
            'A': str(routine.id),  # ID
            'B': routine.name or '',  # Name
            'C': routine.created_at.isoformat() if routine.created_at else '',  # Created
            'D': str(routine.order)  # Order
        }
    
    def _from_sheets_format(self, sheets_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Sheets API format to SQLAlchemy format."""
        result = {
            'name': sheets_data.get('B', ''),
            'order': int(sheets_data.get('D', 0)) if sheets_data.get('D') else 0
        }

        # Preserve user_id if set by RLS middleware
        if 'user_id' in sheets_data:
            result['user_id'] = sheets_data['user_id']

        return result
    
    def _routine_item_to_sheets_format(self, routine_item: RoutineItem) -> Dict[str, Any]:
        """Convert SQLAlchemy RoutineItem to Sheets API format."""
        # CRITICAL: Column B must contain the Google Sheets ItemID (items.item_id),
        # NOT the database primary key (routine_items.item_id)

        # Get the actual ItemID string from the Items table
        query = self.db.query(Item).filter(Item.id == routine_item.item_id)
        query = filter_by_user(query, Item)
        item = query.first()
        item_id_str = item.item_id if item and item.item_id else str(routine_item.item_id)

        return {
            'A': str(routine_item.id),  # RoutineItem ID
            'B': item_id_str,  # Google Sheets ItemID (e.g., "107", not 106)
            'C': str(routine_item.order),  # Order
            'D': 'TRUE' if routine_item.completed else 'FALSE'  # Completed
        }

class ActiveRoutineRepository(BaseRepository):
    def __init__(self, db_session=None):
        super().__init__(ActiveRoutine, db_session)
    
    def get_active_routine(self) -> Optional[Dict[str, Any]]:
        """Get the currently active routine from subscriptions.last_active_routine_id."""
        try:
            with DatabaseTransaction() as tx:
                result = tx.execute(text("""
                    SELECT last_active_routine_id
                    FROM subscriptions
                    WHERE user_id = :user_id
                """), {"user_id": current_user.id})
                sub_row = result.fetchone()

                if sub_row and sub_row[0]:
                    routine_id = sub_row[0]
                    # Verify this routine exists and belongs to the user
                    query = self.db.query(Routine).filter(Routine.id == routine_id)
                    query = filter_by_user(query, Routine)
                    routine = query.first()
                    if routine:
                        return {
                            'A': str(routine.id),
                            'B': routine.name
                        }
                return None
        except Exception as e:
            logging.error(f"Error getting active routine: {e}")
            return None
    
    def set_active_routine(self, routine_id: int) -> bool:
        """Set the active routine in subscriptions.last_active_routine_id."""
        try:
            with DatabaseTransaction() as tx:
                tx.execute(text("""
                    UPDATE subscriptions
                    SET last_active_routine_id = :routine_id
                    WHERE user_id = :user_id
                """), {"routine_id": routine_id, "user_id": current_user.id})
                tx.commit()
            return True
        except Exception as e:
            logging.error(f"Error setting active routine: {e}")
            return False
    
    def clear_active_routine(self) -> bool:
        """Clear the active routine by setting subscriptions.last_active_routine_id to NULL."""
        try:
            with DatabaseTransaction() as tx:
                tx.execute(text("""
                    UPDATE subscriptions
                    SET last_active_routine_id = NULL
                    WHERE user_id = :user_id
                """), {"user_id": current_user.id})
                tx.commit()
            return True
        except Exception as e:
            logging.error(f"Error clearing active routine: {e}")
            return False