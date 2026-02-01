/**
 * Column Letter Mapping - Legacy from Google Sheets Migration
 *
 * BACKGROUND:
 * GPRA was originally built with Google Sheets as the database. When we migrated
 * to PostgreSQL, we kept the column letter convention (A, B, C, etc.) for backward
 * compatibility with the frontend code. This mapping is used throughout the
 * DataLayer abstraction to translate between the original Sheets format and the
 * PostgreSQL schema.
 *
 * IMPORTANT DISTINCTION:
 * - Column A = Database primary key (internal, auto-generated)
 * - Column B = ItemID (the ID used by frontend code and API endpoints)
 *
 * The frontend primarily uses Column B (ItemID) when referencing items.
 * Column A is used internally for database operations.
 *
 * See also:
 * - app/data_layer.py - DataLayer abstraction that handles column mapping
 * - app/repositories/items.py - Repository layer that converts DB records to column format
 * - CLAUDE.md "PostgreSQL Database" section for more context
 */

// =============================================================================
// ITEMS TABLE COLUMNS (practice items: songs, exercises, techniques)
// =============================================================================

export const ITEM_COLUMNS = {
  // Column A: Database primary key (internal use)
  PRIMARY_KEY: 'A',

  // Column B: ItemID - the ID used by frontend and API endpoints
  // This is the main identifier for items in the UI
  ITEM_ID: 'B',

  // Column C: Title of the practice item
  TITLE: 'C',

  // Column D: Notes (markdown supported)
  NOTES: 'D',

  // Column E: Duration in minutes (can be decimal, e.g., 5.5 = 5 min 30 sec)
  DURATION: 'E',

  // Column F: Description (short summary)
  DESCRIPTION: 'F',

  // Column G: Order (for sorting in lists)
  ORDER: 'G',

  // Column H: Tuning (e.g., "EADGBE", "DADGAD", "Drop D")
  TUNING: 'H',

  // Column I: Songbook folder path (for linking to local files)
  SONGBOOK_PATH: 'I',
};

// =============================================================================
// ROUTINES TABLE COLUMNS (practice routine metadata)
// =============================================================================

export const ROUTINE_COLUMNS = {
  // Column A: Database primary key
  ID: 'A',

  // Column B: Routine name
  NAME: 'B',

  // Column C: Created timestamp
  CREATED: 'C',

  // Column D: Order (for sorting routines list)
  ORDER: 'D',
};

// =============================================================================
// ROUTINE ITEMS TABLE COLUMNS (junction table: which items are in which routines)
// =============================================================================

export const ROUTINE_ITEM_COLUMNS = {
  // Column A: Routine entry ID (unique per routine-item relationship)
  // This is different from the item's ID - it's the ID of this specific entry
  ENTRY_ID: 'A',

  // Column B: Item ID (references ITEM_COLUMNS.ITEM_ID, not PRIMARY_KEY)
  ITEM_ID: 'B',

  // Column C: Order within the routine
  ORDER: 'C',

  // Column D: Completed status ('TRUE' or empty string '')
  COMPLETED: 'D',
};

// =============================================================================
// CONVENIENCE ALIASES (for common operations)
// =============================================================================

// When you need to reference an item in API calls, use the ItemID (Column B)
export const ITEM_REFERENCE_COLUMN = ITEM_COLUMNS.ITEM_ID;

// When comparing items in the UI, titles are in Column C
export const ITEM_DISPLAY_COLUMN = ITEM_COLUMNS.TITLE;

// When checking if a routine item is done, check Column D
export const COMPLETION_STATUS_COLUMN = ROUTINE_ITEM_COLUMNS.COMPLETED;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a routine item is marked as completed
 * @param {Object} routineItem - A routine item object with column keys
 * @returns {boolean} True if the item is completed
 */
export const isItemCompleted = (routineItem) => {
  return routineItem[ROUTINE_ITEM_COLUMNS.COMPLETED] === 'TRUE';
};

/**
 * Get the display title from an item object
 * @param {Object} item - An item object with column keys
 * @returns {string} The item's title or empty string
 */
export const getItemTitle = (item) => {
  return item?.[ITEM_COLUMNS.TITLE] || '';
};

/**
 * Get the ItemID (Column B) that should be used for API operations
 * @param {Object} item - An item object with column keys
 * @returns {string} The item's ID for API use
 */
export const getItemId = (item) => {
  return item?.[ITEM_COLUMNS.ITEM_ID] || '';
};

/**
 * Get duration in a formatted string (e.g., "5 min 30 sec")
 * @param {Object} item - An item object with column keys
 * @returns {string} Formatted duration string
 */
export const getFormattedDuration = (item) => {
  const duration = parseFloat(item?.[ITEM_COLUMNS.DURATION] || 0);
  const mins = Math.floor(duration);
  const secs = Math.round((duration % 1) * 60);

  if (secs === 0) {
    return `${mins} min`;
  }
  return `${mins} min ${secs} sec`;
};
