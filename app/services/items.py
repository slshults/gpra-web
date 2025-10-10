from typing import List, Dict, Any, Optional
from app.services.base import BaseService
from app.repositories.items import ItemRepository
from app.repositories.chord_charts import ChordChartRepository
from app.models import Item
import logging

class ItemService(BaseService):
    def get_all_items(self) -> List[Dict[str, Any]]:
        """Get all items in Sheets format for API compatibility."""
        def _get_items():
            repo = ItemRepository(self.db)
            return repo.get_sheets_format()
        
        return self._execute_with_transaction(_get_items)
    
    def get_item(self, item_id: int) -> Optional[Dict[str, Any]]:
        """Get a single item by ID in Sheets format."""
        def _get_item():
            repo = ItemRepository(self.db)
            item = repo.get_by_id(item_id)
            return repo._to_sheets_format(item) if item else None
        
        return self._execute_with_transaction(_get_item)
    
    def create_item(self, item_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new item from Sheets format data."""
        def _create_item():
            repo = ItemRepository(self.db)
            item = repo.create_from_sheets_format(item_data)
            return repo._to_sheets_format(item)
        
        return self._execute_with_transaction(_create_item)
    
    def update_item(self, item_id: int, item_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing item with Sheets format data."""
        def _update_item():
            repo = ItemRepository(self.db)
            item = repo.update_from_sheets_format(item_id, item_data)
            return repo._to_sheets_format(item) if item else None
        
        return self._execute_with_transaction(_update_item)
    
    def delete_item(self, item_id: int) -> bool:
        """Delete an item and all associated chord charts."""
        def _delete_item():
            item_repo = ItemRepository(self.db)
            chord_repo = ChordChartRepository(self.db)
            
            # Get the item to extract its ItemID string
            item = item_repo.get_by_id(item_id)
            if not item:
                return False
                
            # Delete associated chord charts first using ItemID string
            if item.item_id:
                chord_repo.delete_all_for_item(item.item_id)
            
            # Delete the item
            return item_repo.delete(item_id)
        
        return self._execute_with_transaction(_delete_item)
    
    def update_items_order(self, items: List[Dict[str, Any]]) -> bool:
        """Update item ordering (drag-and-drop support)."""
        def _update_order():
            repo = ItemRepository(self.db)
            return repo.update_order(items)
        
        return self._execute_with_transaction(_update_order)
    
    def search_items(self, search_term: str) -> List[Dict[str, Any]]:
        """Search items by title."""
        def _search_items():
            repo = ItemRepository(self.db)
            items = repo.search_by_title(search_term)
            return [repo._to_sheets_format(item) for item in items]
        
        return self._execute_with_transaction(_search_items)
    
    def get_items_by_tuning(self, tuning: str) -> List[Dict[str, Any]]:
        """Get items filtered by tuning."""
        def _get_by_tuning():
            repo = ItemRepository(self.db)
            items = repo.get_by_tuning(tuning)
            return [repo._to_sheets_format(item) for item in items]
        
        return self._execute_with_transaction(_get_by_tuning)
    
    def get_item_stats(self) -> Dict[str, Any]:
        """Get statistics about items."""
        def _get_stats():
            repo = ItemRepository(self.db)
            total_items = repo.count()
            
            # Get tuning distribution
            items = repo.get_all_ordered()
            tunings = {}
            for item in items:
                tuning = item.tuning or 'Unknown'
                tunings[tuning] = tunings.get(tuning, 0) + 1
            
            return {
                'total_items': total_items,
                'tuning_distribution': tunings
            }
        
        return self._execute_with_transaction(_get_stats)
    
    def get_item_by_id(self, item_id: int) -> Optional[Dict[str, Any]]:
        """Get a single item by database ID in Sheets format."""
        return self.get_item(item_id)  # Reuse existing method
    
    def update_item_notes(self, item_id: int, notes: str) -> bool:
        """Update notes for a specific item."""
        def _update_notes():
            repo = ItemRepository(self.db)
            item = repo.get_by_id(item_id)
            if not item:
                return False
            
            # Update the notes field
            item.notes = notes
            repo.db.commit()
            return True
        
        return self._execute_with_transaction(_update_notes)