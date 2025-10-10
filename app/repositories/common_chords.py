from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.models import CommonChord
from app.repositories.base import BaseRepository
import json
import logging

class CommonChordRepository(BaseRepository):
    def __init__(self, db_session=None):
        super().__init__(CommonChord, db_session)

    def get_all_for_autocreate(self) -> List[Dict[str, Any]]:
        """Get all common chords in the format expected by autocreate functionality."""
        try:
            chords = self.db.query(CommonChord).filter(
                CommonChord.name.isnot(None),
                CommonChord.chord_data.isnot(None)
            ).all()

            result = []
            for chord in chords:
                try:
                    # Normalize the chord data structure for autocreate compatibility
                    chord_data = chord.chord_data or {}

                    # Normalize finger data (same as sheets version)
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

                    result.append({
                        'title': chord.name,  # Use 'title' for compatibility with sheets format
                        'fingers': normalized_fingers,
                        'barres': chord_data.get('barres', []),
                        'numFrets': chord_data.get('numFrets', 5),
                        'numStrings': chord_data.get('numStrings', 6),
                        'tuning': chord_data.get('tuning', 'EADGBE'),
                        'capo': chord_data.get('capo', 0),
                        'openStrings': chord_data.get('openStrings', []),
                        'mutedStrings': chord_data.get('mutedStrings', []),
                        'startingFret': chord_data.get('startingFret', 1)
                    })

                except Exception as e:
                    logging.warning(f"Failed to parse common chord {chord.name}: {str(e)}")
                    continue

            logging.info(f"Loaded {len(result)} common chords from PostgreSQL")
            return result

        except Exception as e:
            logging.error(f"Error in get_all_for_autocreate: {str(e)}")
            return []

    def find_by_name(self, name: str) -> Optional[CommonChord]:
        """Find a common chord by exact name match."""
        return self.db.query(CommonChord).filter(
            CommonChord.name == name.strip()
        ).first()

    def search_by_name(self, name: str) -> List[CommonChord]:
        """Search for common chords by name (case-insensitive)."""
        return self.db.query(CommonChord).filter(
            CommonChord.name.ilike(f'%{name.strip()}%')
        ).all()

    def get_by_tuning(self, tuning: str = 'EADGBE') -> List[CommonChord]:
        """Get common chords filtered by tuning."""
        # Since tuning is stored in JSON, we need to filter differently
        return self.db.query(CommonChord).filter(
            CommonChord.chord_data.op('->>')(text("'tuning'")) == tuning
        ).all()

    def count_total(self) -> int:
        """Get total count of common chords."""
        return self.db.query(CommonChord).count()