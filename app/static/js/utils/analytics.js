// PostHog Analytics Utility
// Centralized event tracking for the Guitar Practice Routine App

// Track page visit start times for engagement metrics
let pageStartTimes = {};

// Cache user context for auto-inclusion in events
let userContext = {
  user_id: null,
  subscription_tier: null,
  posthog_distinct_id: null
};

/**
 * Set cached user context from auth status
 * @param {Object} authData - Auth status data from /api/auth/status
 */
export const setUserContext = (authData) => {
  if (authData && authData.authenticated) {
    userContext = {
      user_id: authData.user,
      subscription_tier: authData.tier,
      posthog_distinct_id: authData.posthog_distinct_id
    };
  } else {
    userContext = {
      user_id: null,
      subscription_tier: null,
      posthog_distinct_id: null
    };
  }
};

/**
 * Get cached user context
 * @returns {Object} User context with user_id, subscription_tier, and posthog_distinct_id
 */
export const getUserContext = () => {
  return { ...userContext };
};

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
      window.posthog.capture('page_time_spent', {
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
      ...userContext, // Auto-include user_id and subscription_tier
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
      'started_timer': 'practice_timer_started',
      'marked_done': 'practice_item_completed',
      'timer_reset': 'practice_timer_reset',
      'timer_stopped': 'practice_timer_stopped'
    };

    const eventName = eventMap[eventType] || eventType;
    window.posthog.capture(eventName, {
      item_name: itemName,
      timer_started: eventType === 'started_timer',
      timer_stopped: eventType === 'timer_stopped',
      timer_reset: eventType === 'timer_reset',
      ...userContext, // Auto-include user_id and subscription_tier
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
 * @param {string} action - Action performed (added, edited, deleted, autocreated, copied, chord_chart_created, chord_chart_updated, chord_chart_deleted, autocreate_completed)
 * @param {string|Object} itemNameOrProps - Name of the item the chord chart belongs to, OR properties object (for snake_case events from ChordChartsModal)
 * @param {Object} additionalProperties - Additional properties to track
 */
export const trackChordChartEvent = (action, itemNameOrProps, additionalProperties = {}) => {
  if (typeof window !== 'undefined' && window.posthog) {
    // Map old event names to new snake_case names
    const eventMap = {
      'added': 'chord_chart_created',
      'edited': 'chord_chart_updated',
      'deleted': 'chord_chart_deleted',
      'autocreated': 'chord_charts_autocreated',
      'copied': 'chord_charts_copied',
      // Allow direct snake_case event names (from ChordChartsModal)
      'chord_chart_created': 'chord_chart_created',
      'chord_chart_updated': 'chord_chart_updated',
      'chord_chart_deleted': 'chord_chart_deleted',
      'autocreate_completed': 'chord_charts_autocreated'
    };

    // Handle both old API (action, itemName, props) and new API (action, {itemId, ...props})
    let eventProps = {};
    if (typeof itemNameOrProps === 'object') {
      // New API from ChordChartsModal: { itemId, ...otherProps }
      eventProps = { ...itemNameOrProps, ...additionalProperties };
    } else {
      // Old API: action, itemName, additionalProperties
      eventProps = {
        item_name: itemNameOrProps,
        ...additionalProperties
      };
    }

    window.posthog.capture(eventMap[action] || action, {
      ...userContext, // Auto-include user_id and subscription_tier
      ...eventProps
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
    // Map to snake_case event names
    const eventName = itemType === 'routine'
      ? `routine_${operation}` // routine_created, routine_deleted, routine_updated
      : `practice_item_${operation}`; // practice_item_created, practice_item_deleted, practice_item_updated

    window.posthog.capture(eventName, {
      [`${itemType}_name`]: itemName,
      operation_type: operation,
      item_type: itemType,
      ...userContext, // Auto-include user_id and subscription_tier
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
      'item_added': 'routine_item_added',
      'item_removed': 'routine_item_removed',
      'activated': 'routine_activated'
    };

    const eventData = {
      routine_name: routineName,
      operation_type: operation,
      ...additionalProperties
    };

    if (itemName) {
      eventData.item_name = itemName;
    }

    window.posthog.capture(eventMap[operation] || operation, {
      ...eventData,
      ...userContext // Auto-include user_id and subscription_tier
    });
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
      'notes': 'item_notes_updated',
      'tuning': 'item_tuning_updated',
      'folder_path': 'item_folder_path_updated'
    };

    window.posthog.capture(eventMap[updateType] || `item_${updateType}_updated`, {
      item_name: itemName,
      update_type: updateType,
      ...userContext, // Auto-include user_id and subscription_tier
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
    window.posthog.capture('songbook_folder_link_clicked', {
      item_name: itemName,
      songbook_folder_path: folderPath,
      ...userContext, // Auto-include user_id and subscription_tier
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
    window.posthog.capture('practice_page_viewed', {
      active_routine_name: routineName,
      ...userContext, // Auto-include user_id and subscription_tier
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
  setUserContext,
  getUserContext,
  trackPageVisit,
  trackPracticeEvent,
  trackChordChartEvent,
  trackItemOperation,
  trackRoutineOperation,
  trackContentUpdate,
  trackSongbookLinkClick,
  trackActiveRoutine
};