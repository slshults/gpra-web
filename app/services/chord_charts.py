from typing import List, Dict, Any, Optional
from app.services.base import BaseService
from app.repositories.chord_charts import ChordChartRepository
from app.repositories.items import ItemRepository
from app.models import ChordChart
import logging

class ChordChartService(BaseService):
    def get_for_item(self, item_id: str) -> List[Dict[str, Any]]:
        """Get chord charts for an item in Sheets format."""
        def _get_charts():
            repo = ChordChartRepository(self.db)
            return repo.get_for_item_sheets_format(item_id)
        
        return self._execute_with_transaction(_get_charts)
    
    def create_chord_chart(self, item_id: str, chart_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a single chord chart."""
        def _create_chart():
            repo = ChordChartRepository(self.db)
            charts = repo.batch_create(item_id, [chart_data])
            return repo._to_sheets_format(charts[0]) if charts else {}
        
        return self._execute_with_transaction(_create_chart)
    
    def batch_create(self, item_id: str, chord_charts_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Create multiple chord charts in a single transaction."""
        def _batch_create():
            repo = ChordChartRepository(self.db)
            charts = repo.batch_create(item_id, chord_charts_data)
            return [repo._to_sheets_format(chart) for chart in charts]
        
        return self._execute_with_transaction(_batch_create)
    
    def update_chord_chart(self, chart_id: int, chart_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a chord chart with Sheets format data."""
        def _update_chart():
            repo = ChordChartRepository(self.db)
            chart = repo.update_from_sheets_format(chart_id, chart_data)
            return repo._to_sheets_format(chart) if chart else None
        
        return self._execute_with_transaction(_update_chart)
    
    def delete_chord_chart(self, chart_id: int) -> bool:
        """Delete a single chord chart."""
        def _delete_chart():
            repo = ChordChartRepository(self.db)
            return repo.delete(chart_id)

        return self._execute_with_transaction(_delete_chart)

    def delete_chord_chart_from_item(self, item_id: str, chart_id: int) -> bool:
        """Delete a chord chart from a specific item (handles comma-separated sharing properly)"""
        def _delete_chart_from_item():
            from sqlalchemy import text

            # First, find the chord chart
            chart_result = self.db.execute(text('''
                SELECT chord_id, item_id
                FROM chord_charts
                WHERE chord_id = :chart_id
            '''), {'chart_id': chart_id}).fetchone()

            if not chart_result:
                logging.warning(f"Chord chart {chart_id} not found")
                return False

            current_item_ids_str = chart_result[1]  # item_id column
            current_item_ids = [id.strip() for id in current_item_ids_str.split(',') if id.strip()]

            # Check if the item is actually associated with this chart
            if item_id not in current_item_ids:
                logging.warning(f"Item {item_id} is not associated with chord chart {chart_id}")
                return False

            if len(current_item_ids) == 1:
                # Chart belongs only to this item - delete entirely
                self.db.execute(text('DELETE FROM chord_charts WHERE chord_id = :chart_id'), {'chart_id': chart_id})
                logging.info(f"Deleted chord chart {chart_id} that belonged only to item {item_id}")
            else:
                # Chart is shared - remove only this item from the comma-separated list
                current_item_ids.remove(item_id)
                new_item_ids_str = ', '.join(current_item_ids)
                self.db.execute(text('''
                    UPDATE chord_charts
                    SET item_id = :new_item_ids
                    WHERE chord_id = :chart_id
                '''), {
                    'new_item_ids': new_item_ids_str,
                    'chart_id': chart_id
                })
                logging.info(f"Removed item {item_id} from shared chord chart {chart_id}, now shared by: {new_item_ids_str}")

            self.db.commit()
            return True

        return self._execute_with_transaction(_delete_chart_from_item)
    
    def update_order(self, item_id: str, chord_charts: List[Dict[str, Any]]) -> bool:
        """Update chord chart ordering for an item."""
        def _update_order():
            repo = ChordChartRepository(self.db)
            return repo.update_order(item_id, chord_charts)
        
        return self._execute_with_transaction(_update_order)
    
    def get_sections_for_item(self, item_id: str) -> Dict[str, List[Dict[str, Any]]]:
        """Get chord charts grouped by section for an item."""
        def _get_sections():
            repo = ChordChartRepository(self.db)
            sections = repo.get_sections_for_item(item_id)
            
            # Convert to Sheets format
            result = {}
            for section_id, charts in sections.items():
                result[section_id] = [repo._to_sheets_format(chart) for chart in charts]
            
            return result
        
        return self._execute_with_transaction(_get_sections)
    
    def delete_all_for_item(self, item_id: str) -> int:
        """Delete all chord charts for an item."""
        def _delete_all():
            repo = ChordChartRepository(self.db)
            return repo.delete_all_for_item(item_id)
        
        return self._execute_with_transaction(_delete_all)
    
    def get_chart_stats(self) -> Dict[str, Any]:
        """Get statistics about chord charts."""
        def _get_stats():
            repo = ChordChartRepository(self.db)
            item_repo = ItemRepository(self.db)
            
            total_charts = repo.count()
            total_items = item_repo.count()
            
            # Get items with and without charts
            items_with_charts = self.db.query(ChordChart.item_id).distinct().count()
            items_without_charts = total_items - items_with_charts
            
            return {
                'total_chord_charts': total_charts,
                'items_with_charts': items_with_charts,
                'items_without_charts': items_without_charts,
                'avg_charts_per_item': total_charts / total_items if total_items > 0 else 0
            }
        
        return self._execute_with_transaction(_get_stats)
    
    def copy_chord_charts_to_items(self, source_item_id: str, target_item_ids: List[str]) -> Dict[str, Any]:
        """Copy chord charts from source item to multiple target items using sharing model (PostgreSQL version)."""
        def _copy_charts():
            from sqlalchemy import text

            source_item_id_str = str(source_item_id)
            target_item_ids_str = [str(tid) for tid in target_item_ids]

            # Step 1: Find all chord charts that belong to the source item (using comma-separated matching)
            source_charts = []
            result = self.db.execute(text('''
                SELECT chord_id, item_id, title, chord_data, created_at, order_col
                FROM chord_charts
                WHERE item_id = :exact_id
                   OR item_id LIKE :pattern1
                   OR item_id LIKE :pattern2
                   OR item_id LIKE :pattern3
                ORDER BY order_col
            '''), {
                'exact_id': source_item_id_str,
                'pattern1': f'{source_item_id_str},%',      # "92, 100"
                'pattern2': f'%, {source_item_id_str}',      # "100, 92"
                'pattern3': f'%, {source_item_id_str},%'     # "100, 92, 45"
            }).fetchall()

            if not result:
                logging.warning(f"No chord charts found for source item {source_item_id}")
                return {'updated': 0, 'removed': 0, 'charts_found': 0, 'target_items': target_item_ids}

            updated_count = 0
            removed_count = 0

            # Step 2: Remove existing chord charts from target items (source wins - same as sheets version)
            for target_id in target_item_ids_str:
                logging.info(f"Removing existing chord charts for target item {target_id} before copying")

                # Find charts that contain the target item ID
                target_charts = self.db.execute(text('''
                    SELECT chord_id, item_id FROM chord_charts
                    WHERE item_id = :exact_id
                       OR item_id LIKE :pattern1
                       OR item_id LIKE :pattern2
                       OR item_id LIKE :pattern3
                '''), {
                    'exact_id': target_id,
                    'pattern1': f'{target_id},%',
                    'pattern2': f'%, {target_id}',
                    'pattern3': f'%, {target_id},%'
                }).fetchall()

                for chart_row in target_charts:
                    chart_id, current_item_ids_str = chart_row
                    item_ids = [id.strip() for id in current_item_ids_str.split(',') if id.strip()]

                    if target_id in item_ids:
                        if len(item_ids) == 1:
                            # Chart belongs only to target - remove entirely
                            self.db.execute(text('DELETE FROM chord_charts WHERE chord_id = :chart_id'), {'chart_id': chart_id})
                            removed_count += 1
                            logging.info(f"Removed chart {chart_id} that belonged only to item {target_id}")
                        else:
                            # Chart is shared - remove target from the list
                            item_ids.remove(target_id)
                            new_item_ids_str = ', '.join(item_ids)
                            self.db.execute(text('UPDATE chord_charts SET item_id = :new_item_ids WHERE chord_id = :chart_id'), {
                                'new_item_ids': new_item_ids_str,
                                'chart_id': chart_id
                            })
                            logging.info(f"Removed item {target_id} from shared chart {chart_id}")

            # Step 3: Add target item IDs to source charts (sharing model - same as sheets version)
            for chart_row in result:
                chart_id, current_item_ids_str = chart_row[0], chart_row[1]
                current_item_ids = [id.strip() for id in current_item_ids_str.split(',') if id.strip()]

                # Add target item IDs if they're not already present
                for target_id in target_item_ids_str:
                    if target_id not in current_item_ids:
                        current_item_ids.append(target_id)
                        logging.info(f"Added item {target_id} to chart {chart_id}")

                # Update the ItemID column with comma-separated list
                new_item_ids_str = ', '.join(current_item_ids)
                self.db.execute(text('UPDATE chord_charts SET item_id = :new_item_ids WHERE chord_id = :chart_id'), {
                    'new_item_ids': new_item_ids_str,
                    'chart_id': chart_id
                })
                updated_count += 1

            self.db.commit()

            logging.info(f"Successfully copied {len(result)} chord charts from item {source_item_id} to {len(target_item_ids)} items: {updated_count} charts updated, {removed_count} existing charts removed")

            return {
                'updated': updated_count,
                'removed': removed_count,
                'charts_found': len(result),
                'target_items': target_item_ids
            }

        return self._execute_with_transaction(_copy_charts)