from typing import List, Optional, Dict, Any
from sqlalchemy import func, and_
from app.models import Item, ChordChart
from app.repositories.base import BaseRepository
from app.middleware.rls import filter_by_user

class ItemRepository(BaseRepository):
    def __init__(self, db_session=None):
        super().__init__(Item, db_session)
    
    def get_all_ordered(self) -> List[Item]:
        """Get all items ordered by order column, then title."""
        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.order_by(Item.order, Item.title).all()
    
    def get_lightweight(self) -> List[Dict[str, Any]]:
        """Get minimal item data for list views (mimics Sheets format)."""
        query = self.db.query(Item.id, Item.title)
        query = filter_by_user(query, Item)
        items = query.order_by(Item.order, Item.title).all()
        return [{'A': str(item.id), 'C': item.title} for item in items]
    
    def get_sheets_format(self) -> List[Dict[str, Any]]:
        """Get all items in Google Sheets format for API compatibility."""
        items = self.get_all_ordered()
        return [self._to_sheets_format(item) for item in items]
    
    def create_from_sheets_format(self, sheets_data: Dict[str, Any]) -> Item:
        """Create item from Google Sheets format data."""
        item_data = self._from_sheets_format(sheets_data)
        
        # Create the item first
        item = self.create(**item_data)
        
        # If item_id is empty, set it to the database ID for compatibility
        if not item.item_id:
            item.item_id = str(item.id)
            self.db.commit()
            self.db.refresh(item)
        
        return item
    
    def update_from_sheets_format(self, item_id: int, sheets_data: Dict[str, Any]) -> Optional[Item]:
        """Update item using Google Sheets format data."""
        # Convert from sheets format but exclude fields that shouldn't be updated
        item_data = self._from_sheets_format(sheets_data)

        # Remove item_id to prevent overwriting the unique identifier
        # This matches the sheets version behavior which excludes Column A (ID) and Column G (order) from updates
        item_data.pop('item_id', None)

        # Only update order if explicitly provided and different
        if 'G' not in sheets_data:
            item_data.pop('order', None)

        return self.update(item_id, **item_data)
    
    def update_order(self, items: List[Dict[str, Any]]) -> bool:
        """Batch update item ordering."""
        try:
            for item_data in items:
                # Column A contains the Google Sheets ItemID, not the database primary key
                sheets_item_id = str(item_data['A'])
                new_order = int(item_data.get('G', 0)) if item_data.get('G') else 0
                query = self.db.query(Item).filter(Item.item_id == sheets_item_id)
                query = filter_by_user(query, Item)
                query.update({Item.order: new_order})
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            return False
    
    def search_by_title(self, search_term: str) -> List[Item]:
        """Search items by title (case-insensitive)."""
        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.filter(
            Item.title.ilike(f'%{search_term}%')
        ).order_by(Item.title).all()
    
    def get_by_tuning(self, tuning: str) -> List[Item]:
        """Get items filtered by tuning."""
        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.filter(Item.tuning == tuning).order_by(Item.title).all()
    
    def get_with_chord_charts(self, item_id: int) -> Optional[Item]:
        """Get item with chord charts eagerly loaded."""
        query = self.db.query(Item)
        query = filter_by_user(query, Item)
        return query.filter(Item.id == item_id).first()
    
    # Format conversion helpers
    def _to_sheets_format(self, item: Item) -> Dict[str, Any]:
        """Convert SQLAlchemy Item to Sheets API format."""
        return {
            'A': str(item.id),
            'B': item.item_id or '',
            'C': item.title or '',
            'D': item.notes or '',
            'E': item.duration or '',
            'F': item.description or '',
            'G': str(item.order),
            'H': item.tuning or '',
            'I': item.songbook or ''
        }
    
    def _from_sheets_format(self, sheets_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Sheets API format to SQLAlchemy format."""
        return {
            'item_id': sheets_data.get('B', ''),
            'title': sheets_data.get('C', ''),
            'notes': sheets_data.get('D', ''),
            'duration': sheets_data.get('E', ''),
            'description': sheets_data.get('F', ''),
            'order': int(sheets_data.get('G', 0)) if sheets_data.get('G') else 0,
            'tuning': sheets_data.get('H', ''),
            'songbook': sheets_data.get('I', '')
        }