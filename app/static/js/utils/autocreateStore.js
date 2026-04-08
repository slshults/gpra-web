import { debugLog } from '@utils/logging';

// Module-level store for in-progress visual analysis (survives component unmount/remount)
// Shared between PracticePage and ChordChartsModal so queue gating works across both.
const autocreateStore = {
  // Map of itemId -> { itemName, abortController, notifyRequested, startTime, type }
  activeRequests: {},
  // Map of itemId -> { status, result, error } for completed requests not yet consumed
  completedRequests: {},

  startRequest(itemId, itemName, abortController, type) {
    this.activeRequests[itemId] = {
      itemName,
      abortController,
      notifyRequested: false,
      startTime: Date.now(),
      type
    };
  },
  completeRequest(itemId, status, result, handledInline = false) {
    delete this.activeRequests[itemId];
    this.completedRequests[itemId] = { status, result };
    // Dispatch event for global watcher (AutocreateWatcher.jsx)
    window.dispatchEvent(new CustomEvent('autocreate-complete', {
      detail: { itemId, status, result, handledInline }
    }));
  },
  cancelRequest(itemId) {
    const active = this.activeRequests[itemId];
    if (active?.abortController) {
      active.abortController.abort();
    }
    delete this.activeRequests[itemId];
  },
  // Remove entry without aborting (for completed requests that don't need store tracking)
  clearRequest(itemId) {
    delete this.activeRequests[itemId];
  },
  getActive(itemId) {
    return this.activeRequests[itemId] || null;
  },
  getActiveVisualAnalysis() {
    const entries = Object.entries(this.activeRequests);
    for (const [itemId, req] of entries) {
      if (req.type === 'visual_analysis') {
        return { itemId, ...req };
      }
    }
    return null;
  },
  consumeCompleted(itemId) {
    const completed = this.completedRequests[itemId];
    if (completed) {
      delete this.completedRequests[itemId];
    }
    return completed || null;
  },
  setNotifyRequested(itemId) {
    if (this.activeRequests[itemId]) {
      this.activeRequests[itemId].notifyRequested = true;
    }
  }
};

// Fire a browser notification if permission was granted
const fireAutocreateNotification = (title, body) => {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/static/images/GPRA-192x192.png'
      });
    }
  } catch (e) {
    debugLog('NOTIFY', 'Failed to fire notification:', e);
  }
};

export { autocreateStore, fireAutocreateNotification };
