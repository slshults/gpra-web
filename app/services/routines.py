from typing import List, Optional, Dict, Any
from app.services.base import BaseService
from app.repositories.routines import RoutineRepository, ActiveRoutineRepository
from app.models import Routine, RoutineItem
import logging

logger = logging.getLogger(__name__)

class RoutineService(BaseService):
    """Service layer for routine operations with transaction management."""
    
    def get_all_routines(self) -> List[Dict[str, Any]]:
        """Get all routines in Sheets format with active status."""
        def _get_routines():
            routine_repo = RoutineRepository(self.db)
            active_repo = ActiveRoutineRepository(self.db)
            
            # Get raw sheets format data
            routines_raw = routine_repo.get_sheets_format()
            
            # Get active routine ID
            active_routine_data = active_repo.get_active_routine()
            active_id = active_routine_data.get('A') if active_routine_data else None
            
            # Transform to include proper field names and active status
            routines = []
            for record in routines_raw:
                routine = {
                    'ID': record['A'],  # Column A for ID
                    'name': record['B'],  # Column B for name
                    'created': record['C'],  # Column C for created date
                    'order': record['D'],  # Column D for order
                    'active': record['A'] == active_id if active_id else False  # Compare IDs
                }
                routines.append(routine)
            
            return routines
        
        return self._execute_with_transaction(_get_routines)
    
    def create_routine(self, routine_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new routine from Sheets format data."""
        def _create_routine():
            routine_repo = RoutineRepository(self.db)
            routine = routine_repo.create_from_sheets_format(routine_data)
            return routine_repo._to_sheets_format(routine)
        
        return self._execute_with_transaction(_create_routine)
    
    def update_routine(self, routine_id: int, routine_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update routine with Sheets format data."""
        def _update_routine():
            routine_repo = RoutineRepository(self.db)
            routine = routine_repo.update_from_sheets_format(routine_id, routine_data)
            return routine_repo._to_sheets_format(routine) if routine else None
        
        return self._execute_with_transaction(_update_routine)
    
    def delete_routine(self, routine_id: int) -> bool:
        """Delete a routine and all its routine items."""
        def _delete_routine():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.delete(routine_id)
        
        return self._execute_with_transaction(_delete_routine)
    
    def get_routine_with_items(self, routine_id: int) -> Optional[Dict[str, Any]]:
        """Get routine with all its items and their details."""
        def _get_routine_with_items():
            routine_repo = RoutineRepository(self.db)
            routine = routine_repo.get_with_items(routine_id)
            if routine:
                # Convert to Sheets format
                routine_data = routine_repo._to_sheets_format(routine)
                
                # Build items list with both routine item data and item details
                # CRITICAL: Do NOT sort by order column - preserve physical insertion order from sheets migration
                # The order column contains drag-and-drop values with gaps and is for display logic only
                items = []
                for routine_item in routine.routine_items:
                    # Create routine item in sheets format
                    routine_item_data = routine_repo._routine_item_to_sheets_format(routine_item)

                    # Structure the data to match frontend expectations: {routineEntry: {...}, itemDetails: {...}}
                    structured_item = {
                        'routineEntry': routine_item_data
                    }

                    # Add item details if available
                    if routine_item.item:
                        structured_item['itemDetails'] = {
                            'A': str(routine_item.item.item_id),  # Use item_id (Google Sheets ItemID) for API consistency
                            'B': str(routine_item.item.item_id),  # Column B is also ItemID for consistency
                            'C': routine_item.item.title or '',
                            'D': routine_item.item.notes or '',
                            'E': routine_item.item.duration or '',
                            'F': routine_item.item.description or '',
                            'H': routine_item.item.tuning or '',
                            'I': routine_item.item.songbook or ''
                        }

                    items.append(structured_item)
                
                # Items now preserve physical insertion order (no sorting applied)
                routine_data['items'] = items
                return routine_data
            return None
        
        return self._execute_with_transaction(_get_routine_with_items)
    
    def get_routine_items(self, routine_id: int) -> List[Dict[str, Any]]:
        """Get routine items in Sheets format."""
        def _get_routine_items():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.get_routine_items_sheets_format(routine_id)
        
        return self._execute_with_transaction(_get_routine_items)
    
    def add_item_to_routine(self, routine_id: int, item_id: int, order: int = None) -> Dict[str, Any]:
        """Add an item to a routine."""
        def _add_item():
            routine_repo = RoutineRepository(self.db)
            routine_item = routine_repo.add_item_to_routine(routine_id, item_id, order)
            return routine_repo._routine_item_to_sheets_format(routine_item)
        
        return self._execute_with_transaction(_add_item)
    
    def remove_item_from_routine(self, routine_id: int, item_id: int) -> bool:
        """Remove an item from a routine."""
        def _remove_item():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.remove_item_from_routine(routine_id, item_id)

        return self._execute_with_transaction(_remove_item)

    def remove_routine_item_by_id(self, routine_id: int, routine_item_id: int) -> bool:
        """Remove a specific routine item by its ID."""
        def _remove_routine_item():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.remove_routine_item_by_id(routine_id, routine_item_id)

        return self._execute_with_transaction(_remove_routine_item)
    
    def update_routine_items_order(self, routine_id: int, items: List[Dict[str, Any]]) -> bool:
        """Update routine item ordering."""
        def _update_order():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.update_routine_items_order(routine_id, items)
        
        return self._execute_with_transaction(_update_order)

    def update_routines_order(self, routines: List[Dict[str, Any]]) -> bool:
        """Update the order of routines in the routines list."""
        def _update_order():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.update_routines_order(routines)

        return self._execute_with_transaction(_update_order)

    def update_routine_item(self, routine_id: int, routine_item_id: str, item_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a specific routine item."""
        def _update_item():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.update_routine_item(routine_id, routine_item_id, item_data)

        return self._execute_with_transaction(_update_item)

    def mark_item_complete(self, routine_id: int, routine_item_id: int, completed: bool = True) -> bool:
        """Mark a routine item as completed or not."""
        def _mark_complete():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.mark_item_complete(routine_id, routine_item_id, completed)
        
        return self._execute_with_transaction(_mark_complete)
    
    def reset_routine_progress(self, routine_id: int) -> bool:
        """Reset all items in a routine to not completed."""
        def _reset_progress():
            routine_repo = RoutineRepository(self.db)
            return routine_repo.reset_routine_progress(routine_id)
        
        return self._execute_with_transaction(_reset_progress)
    
    # Active routine management
    def get_active_routine(self) -> Optional[Dict[str, Any]]:
        """Get the currently active routine."""
        def _get_active():
            active_repo = ActiveRoutineRepository(self.db)
            return active_repo.get_active_routine()
        
        return self._execute_with_transaction(_get_active)
    
    def set_active_routine(self, routine_id: int) -> bool:
        """Set the active routine."""
        def _set_active():
            active_repo = ActiveRoutineRepository(self.db)
            return active_repo.set_active_routine(routine_id)
        
        return self._execute_with_transaction(_set_active)
    
    def clear_active_routine(self) -> bool:
        """Clear the active routine."""
        def _clear_active():
            active_repo = ActiveRoutineRepository(self.db)
            return active_repo.clear_active_routine()
        
        return self._execute_with_transaction(_clear_active)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get routine statistics."""
        def _get_stats():
            routine_repo = RoutineRepository(self.db)
            active_repo = ActiveRoutineRepository(self.db)
            
            total_routines = routine_repo.count()
            active_routine = active_repo.get_active_routine()
            
            return {
                'total_routines': total_routines,
                'has_active_routine': active_routine is not None,
                'active_routine_id': active_routine.get('A') if active_routine else None,
                'active_routine_name': active_routine.get('B') if active_routine else None
            }
        
        return self._execute_with_transaction(_get_stats)

# Singleton instance
routine_service = RoutineService()