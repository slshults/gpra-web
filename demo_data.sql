-- Guitar Practice Routine App - Demo Data
-- This file inserts sample data to demonstrate the application features

-- Insert demo routine
INSERT INTO routines (id, name, created_at, "order") VALUES
(1, 'Demo routine', NOW(), 0);

-- Insert demo practice item
INSERT INTO items (id, item_id, title, notes, duration, description, "order", tuning, songbook, created_at, updated_at) VALUES
(1, '1', 'For What It''s Worth', 'Classic Buffalo Springfield song - great for practicing basic chord changes', '5', 'Work on smooth transitions between E and A chords. Focus on strumming pattern and timing.', 0, 'EADGBE', 'D:\Users\YourUserNameHere\Documents\Guitar\Songbook\ForWhatItsWorth', NOW(), NOW());

-- Add item to routine
INSERT INTO routine_items (routine_id, item_id, "order", completed, created_at) VALUES
(1, 1, 0, FALSE, NOW());

-- Set as active routine
INSERT INTO active_routine (id, routine_id, updated_at) VALUES
(1, 1, NOW());

-- Insert chord charts for the song
-- E chord
INSERT INTO chord_charts (chord_id, item_id, title, chord_data, created_at, order_col) VALUES
(1, '1', 'E', '{
  "fingers": [[2, 2, null], [3, 2, null], [4, 1, null]],
  "barres": [],
  "tuning": "EADGBE",
  "capo": 0,
  "startingFret": 1,
  "numFrets": 4,
  "numStrings": 6,
  "openStrings": [1, 6],
  "mutedStrings": [],
  "sectionId": "section-chorus",
  "sectionLabel": "Chorus",
  "sectionRepeatCount": "",
  "hasLineBreakAfter": false
}', NOW(), 0);

-- D chord
INSERT INTO chord_charts (chord_id, item_id, title, chord_data, created_at, order_col) VALUES
(2, '1', 'D', '{
  "fingers": [[1, 2, null], [2, 3, null], [3, 2, null]],
  "barres": [],
  "tuning": "EADGBE",
  "capo": 0,
  "startingFret": 1,
  "numFrets": 4,
  "numStrings": 6,
  "openStrings": [4],
  "mutedStrings": [5, 6],
  "sectionId": "section-chorus",
  "sectionLabel": "Chorus",
  "sectionRepeatCount": "",
  "hasLineBreakAfter": false
}', NOW(), 1);

-- A chord
INSERT INTO chord_charts (chord_id, item_id, title, chord_data, created_at, order_col) VALUES
(3, '1', 'A', '{
  "fingers": [[2, 2, null], [3, 2, null], [4, 2, null]],
  "barres": [],
  "tuning": "EADGBE",
  "capo": 0,
  "startingFret": 1,
  "numFrets": 4,
  "numStrings": 6,
  "openStrings": [1, 5],
  "mutedStrings": [6],
  "sectionId": "section-chorus",
  "sectionLabel": "Chorus",
  "sectionRepeatCount": "",
  "hasLineBreakAfter": false
}', NOW(), 2);

-- A7 chord
INSERT INTO chord_charts (chord_id, item_id, title, chord_data, created_at, order_col) VALUES
(4, '1', 'A7', '{
  "fingers": [[2, 2, null], [4, 2, null]],
  "barres": [],
  "tuning": "EADGBE",
  "capo": 0,
  "startingFret": 1,
  "numFrets": 4,
  "numStrings": 6,
  "openStrings": [1, 3, 5],
  "mutedStrings": [6],
  "sectionId": "section-chorus",
  "sectionLabel": "Chorus",
  "sectionRepeatCount": "",
  "hasLineBreakAfter": false
}', NOW(), 3);