from typing import List, Dict, Any, Optional
from app.services.base import BaseService
from app.repositories.common_chords import CommonChordRepository
import logging

class CommonChordService(BaseService):
    def get_all_for_autocreate(self) -> List[Dict[str, Any]]:
        """Get all common chords in autocreate-compatible format."""
        def _get_chords():
            repo = CommonChordRepository(self.db)
            return repo.get_all_for_autocreate()

        return self._execute_with_transaction(_get_chords)

    def find_chord_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Find a specific chord by name and return in autocreate format."""
        def _find_chord():
            repo = CommonChordRepository(self.db)
            chord = repo.find_by_name(name)

            if not chord or not chord.chord_data:
                return None

            # Convert to autocreate format (same structure as get_all_for_autocreate)
            chord_data = chord.chord_data or {}

            # Normalize finger data
            raw_fingers = chord_data.get('fingers', [])
            normalized_fingers = []

            for finger in raw_fingers:
                if isinstance(finger, dict):
                    string_num = finger.get('string')
                    fret_num = finger.get('fret')
                    finger_num = finger.get('finger')
                    if string_num is not None and fret_num is not None:
                        if finger_num is not None:
                            normalized_fingers.append([string_num, fret_num, finger_num])
                        else:
                            normalized_fingers.append([string_num, fret_num])
                elif isinstance(finger, list) and len(finger) >= 2:
                    normalized_fingers.append(finger)

            return {
                'title': chord.name,
                'fingers': normalized_fingers,
                'barres': chord_data.get('barres', []),
                'numFrets': chord_data.get('numFrets', 5),
                'numStrings': chord_data.get('numStrings', 6),
                'tuning': chord_data.get('tuning', 'EADGBE'),
                'capo': chord_data.get('capo', 0),
                'openStrings': chord_data.get('openStrings', []),
                'mutedStrings': chord_data.get('mutedStrings', []),
                'startingFret': chord_data.get('startingFret', 1)
            }

        return self._execute_with_transaction(_find_chord)

    def search_chords_by_name(self, name: str) -> List[Dict[str, Any]]:
        """Search for chords by name pattern."""
        def _search_chords():
            repo = CommonChordRepository(self.db)
            chords = repo.search_by_name(name)
            return [{'name': chord.name, 'id': chord.id} for chord in chords]

        return self._execute_with_transaction(_search_chords)

    def get_chord_count(self) -> int:
        """Get total count of available common chords."""
        def _get_count():
            repo = CommonChordRepository(self.db)
            return repo.count_total()

        return self._execute_with_transaction(_get_count)