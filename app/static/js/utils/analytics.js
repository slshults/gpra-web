// PostHog Analytics Utility
// Centralized event tracking for the Guitar Practice Routine App

// Track page visit start times for engagement metrics
let pageStartTimes = {};

/**
 * Track page visits for SPA navigation
 * @param {string} pageName - Name of the page visited
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackPageVisit = (pageName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    // Track time spent on previous page
    const previousPage = additionalProperties.previous_page;
    if (previousPage && pageStartTimes[previousPage]) {
      const timeSpent = Date.now() - pageStartTimes[previousPage];
      window.posthog.capture('Page Time Spent', {
        page_name: previousPage,
        time_spent_ms: timeSpent,
        time_spent_seconds: Math.round(timeSpent / 1000),
        next_page: pageName
      });
    }

    // Record start time for current page
    pageStartTimes[pageName] = Date.now();

    // Manual SPA pageview tracking using proper $pageview event
    window.posthog.capture('$pageview', {
      $current_url: `${window.location.origin}${window.location.pathname}#${pageName}`,
      $host: window.location.host,
      $pathname: window.location.pathname,
      $search: window.location.search,
      title: `Guitar Practice - ${pageName}`,
      page_name: pageName,
      spa_navigation: true,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      ...additionalProperties
    });
  }
};

/**
 * Track practice session events
 * @param {string} eventType - Type of practice event (started_timer, marked_done, timer_reset, etc.)
 * @param {string} itemName - Name of the practice item
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackPracticeEvent = (eventType, itemName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    const eventMap = {
      'started_timer': 'Started Timer',
      'marked_done': 'Item Marked Done',
      'timer_reset': 'Timer Reset',
      'timer_stopped': 'Timer Stopped'
    };

    const eventName = eventMap[eventType] || eventType;
    window.posthog.capture(eventName, {
      item_name: itemName,
      timer_started: eventType === 'started_timer',
      timer_stopped: eventType === 'timer_stopped',
      timer_reset: eventType === 'timer_reset',
      ...additionalProperties
    });

    // Also log to backend for practice data download feature
    fetch('/api/user/practice-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        item_name: itemName,
        duration_seconds: additionalProperties.duration_seconds,
        additional_data: additionalProperties
      })
    }).catch(err => console.error('Failed to log practice event:', err));
  }
};

/**
 * Track chord chart interactions
 * @param {string} action - Action performed (added, edited, deleted, autocreated, copied)
 * @param {string} itemName - Name of the item the chord chart belongs to
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackChordChartEvent = (action, itemName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    const eventMap = {
      'added': 'Chord Chart Added',
      'edited': 'Chord Chart Edited', 
      'deleted': 'Chord Chart Deleted',
      'autocreated': 'Chord Charts Autocreated',
      'copied': 'Chord Charts Copied'
    };

    window.posthog.capture(eventMap[action] || action, {
      item_name: itemName,
      ...additionalProperties
    });
  }
};

/**
 * Track item CRUD operations
 * @param {string} operation - CRUD operation (created, deleted, updated)
 * @param {string} itemType - Type of item (item, routine)
 * @param {string} itemName - Name of the item
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackItemOperation = (operation, itemType, itemName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    const eventName = itemType === 'routine' 
      ? `${operation.charAt(0).toUpperCase() + operation.slice(1)} Routine`
      : `${operation.charAt(0).toUpperCase() + operation.slice(1)} Item`;

    window.posthog.capture(eventName, {
      [`${itemType}_name`]: itemName,
      operation_type: operation,
      item_type: itemType,
      ...additionalProperties
    });
  }
};

/**
 * Track routine operations
 * @param {string} operation - Operation performed (item_added, item_removed, activated)
 * @param {string} routineName - Name of the routine
 * @param {string} itemName - Name of the item (if applicable)
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackRoutineOperation = (operation, routineName, itemName = null, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    const eventMap = {
      'item_added': 'Item Added to Routine',
      'item_removed': 'Item Removed from Routine', 
      'activated': 'Routine Activated'
    };

    const eventData = {
      routine_name: routineName,
      operation_type: operation,
      ...additionalProperties
    };

    if (itemName) {
      eventData.item_name = itemName;
    }

    window.posthog.capture(eventMap[operation] || operation, eventData);
  }
};

/**
 * Track content updates (notes, tuning, folder paths)
 * @param {string} updateType - Type of update (notes, tuning, folder_path)
 * @param {string} itemName - Name of the item
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackContentUpdate = (updateType, itemName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    const eventMap = {
      'notes': 'Notes Added',
      'tuning': 'Tuning Added', 
      'folder_path': 'Folder Path Added'
    };

    window.posthog.capture(eventMap[updateType] || `${updateType} Updated`, {
      item_name: itemName,
      update_type: updateType,
      ...additionalProperties
    });
  }
};

/**
 * Track songbook interactions
 * @param {string} itemName - Name of the item
 * @param {string} folderPath - Path to the songbook folder
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackSongbookLinkClick = (itemName, folderPath, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture('Songbook Folder Link Clicked', {
      item_name: itemName,
      songbook_folder_path: folderPath,
      ...additionalProperties
    });
  }
};

/**
 * Track active routine when practice page is visited
 * @param {string} routineName - Name of the active routine
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackActiveRoutine = (routineName, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture('Practice Page Visited', {
      active_routine_name: routineName,
      ...additionalProperties
    });

    // Also log to backend for practice data download feature
    fetch('/api/user/practice-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'practice_page_visited',
        routine_name: routineName,
        additional_data: additionalProperties
      })
    }).catch(err => console.error('Failed to log practice event:', err));
  }
};

/**
 * Debug helper to log events to console in development
 * @param {string} eventName - Name of the event
 * @param {Object} properties - Event properties
 */
const debugLog = (eventName, properties) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Analytics] ${eventName}:`, properties);
  }
};

// Export all functions for easy importing
export default {
  trackPageVisit,
  trackPracticeEvent,
  trackChordChartEvent,
  trackItemOperation,
  trackRoutineOperation,
  trackContentUpdate,
  trackSongbookLinkClick,
  trackActiveRoutine
};