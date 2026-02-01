// PostHog Feedback Survey Trigger
// Triggers the in-app feedback survey when user clicks "Reach out" buttons
//
// IMPORTANT: You must create a survey in PostHog dashboard first:
// 1. Go to PostHog -> Surveys -> New survey
// 2. Use the "Open feedback" template
// 3. Under "Display conditions", do NOT set any automatic triggers (API only)
// 4. Copy the survey ID and update FEEDBACK_SURVEY_ID below
// 5. Launch the survey

// TODO: Replace with actual survey ID from PostHog dashboard
const FEEDBACK_SURVEY_ID = '019b8c09-f649-0000-bb6e-f74eb6e0d0ac';

// Development-only console logging (checks Flask debug mode via window.GPRA_DEBUG)
function debugLog(prefix, ...args) {
  if (typeof window !== 'undefined' && window.GPRA_DEBUG === true) {
    console.log(`[${prefix}]`, ...args);
  }
}

/**
 * Triggers the PostHog feedback survey
 * Uses displaySurvey() which is the recommended method for programmatic display
 * See: https://posthog.com/docs/surveys/implementing-custom-surveys
 *
 * @param {Event} event - Click event (optional, will prevent default if provided)
 */
function triggerFeedbackSurvey(event) {
  // Prevent default link behavior
  if (event) {
    event.preventDefault();
  }

  debugLog('FeedbackSurvey', 'Button clicked, checking PostHog availability...');

  // Check if PostHog is available and user has consented to analytics
  // Note: typeof is the only safe way to check undeclared variables
  const posthogExists = typeof posthog !== 'undefined';
  debugLog('FeedbackSurvey', 'posthog exists:', posthogExists);

  if (posthogExists) {
    debugLog('FeedbackSurvey', 'posthog.displaySurvey:', typeof posthog.displaySurvey);
    debugLog('FeedbackSurvey', 'posthog.__loaded:', posthog.__loaded);
  }

  if (!posthogExists || !posthog.displaySurvey) {
    // PostHog not loaded (user opted out of analytics) or surveys not available
    // Fall back to a simple alert with contact info
    debugLog('FeedbackSurvey', 'PostHog not available or displaySurvey missing, showing fallback');
    debugLog('FeedbackSurvey', 'Cookie consent:', localStorage.getItem('cookieConsent'));
    showFallbackContactInfo();
    return;
  }

  // Check if survey ID is configured
  if (FEEDBACK_SURVEY_ID === 'YOUR_SURVEY_ID_HERE') {
    console.warn('[FeedbackSurvey] Survey ID not configured. Please update FEEDBACK_SURVEY_ID in feedback-survey.js');
    showFallbackContactInfo();
    return;
  }

  debugLog('FeedbackSurvey', 'Survey ID:', FEEDBACK_SURVEY_ID);

  // Use onSurveysLoaded to ensure surveys are initialized before displaying
  // This is important because surveys may not be immediately available on page load
  if (posthog.onSurveysLoaded) {
    debugLog('FeedbackSurvey', 'Waiting for surveys to load...');
    posthog.onSurveysLoaded(function() {
      debugLog('FeedbackSurvey', 'Surveys loaded callback fired');
      displayTheSurvey();
    });
  } else {
    // If onSurveysLoaded is not available, try displaying directly
    debugLog('FeedbackSurvey', 'onSurveysLoaded not available, trying direct display');
    displayTheSurvey();
  }
}

/**
 * MutationObserver to watch for PostHog survey elements and inject styles immediately
 * This is much faster than waiting with setTimeout
 */
let surveyObserver = null;

function startSurveyObserver() {
  // Don't create multiple observers
  if (surveyObserver) {
    return;
  }

  surveyObserver = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if this node or any child matches PostHog survey
          const surveyEl = node.matches && node.matches('[class*="PostHogSurvey"]')
            ? node
            : node.querySelector && node.querySelector('[class*="PostHogSurvey"]');

          if (surveyEl) {
            debugLog('FeedbackSurvey', 'MutationObserver detected survey element');
            // PostHog may need a moment to attach shadowRoot
            attemptStyleInjection(surveyEl);
          }
        }
      }
    }
  });

  surveyObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  debugLog('FeedbackSurvey', 'MutationObserver started');
}

function stopSurveyObserver() {
  if (surveyObserver) {
    surveyObserver.disconnect();
    surveyObserver = null;
    debugLog('FeedbackSurvey', 'MutationObserver stopped');
  }
}

/**
 * Attempts to inject styles, with retries for shadowRoot attachment
 * PostHog may attach shadowRoot slightly after the element is added
 */
function attemptStyleInjection(surveyEl, retryCount = 0) {
  if (surveyEl.shadowRoot) {
    injectSurveyStyles(surveyEl.shadowRoot);
    stopSurveyObserver();
  } else if (retryCount < 10) {
    // Retry with requestAnimationFrame for tighter timing
    requestAnimationFrame(function() {
      attemptStyleInjection(surveyEl, retryCount + 1);
    });
  } else {
    debugLog('FeedbackSurvey', 'shadowRoot not available after retries');
  }
}

/**
 * Injects GPRA dark theme styles into PostHog survey's shadow DOM
 * PostHog uses shadow DOM which isolates styles, so we need to inject directly
 */
function injectSurveyStyles(shadowRoot) {
  // Check if we've already injected styles
  if (shadowRoot.querySelector('#gpra-survey-styles')) {
    debugLog('FeedbackSurvey', 'Styles already injected');
    return;
  }

  const styleEl = document.createElement('style');
  styleEl.id = 'gpra-survey-styles';
  styleEl.textContent = `
    /* GPRA dark theme for PostHog survey textarea */
    textarea {
      background-color: #0a0d14 !important;
      color: #f7f9fb !important;
      border-color: #374151 !important;
    }
    textarea::placeholder {
      color: #9ca3af !important;
    }
  `;
  shadowRoot.appendChild(styleEl);
  debugLog('FeedbackSurvey', 'Injected GPRA styles into shadow DOM');
}

/**
 * Actually displays the survey
 * Separated out for clarity and reuse
 */
function displayTheSurvey() {
  try {
    debugLog('FeedbackSurvey', 'Attempting to display survey...');

    // Clean up any existing survey DOM element (workaround for PostHog bug where
    // survey won't show again after being closed)
    // See: https://github.com/PostHog/posthog-js/issues/2586
    const existingSurvey = document.querySelector('.PostHogSurvey-' + FEEDBACK_SURVEY_ID);
    if (existingSurvey) {
      debugLog('FeedbackSurvey', 'Removing existing survey DOM element');
      existingSurvey.remove();
    }

    // Check if surveys are available by trying to get them first
    if (posthog.getSurveys) {
      // Force reload to get fresh survey data
      posthog.getSurveys(function(surveys) {
        debugLog('FeedbackSurvey', 'All surveys from getSurveys:', surveys);
        const ourSurvey = surveys.find(s => s.id === FEEDBACK_SURVEY_ID);
        if (ourSurvey) {
          debugLog('FeedbackSurvey', 'Found our survey:', ourSurvey.name, 'type:', ourSurvey.type);
        } else {
          console.warn('[FeedbackSurvey] Our survey ID not found in getSurveys');
          debugLog('FeedbackSurvey', 'Survey IDs available:', surveys.map(s => s.id));
        }
      }, true); // forceReload = true
    }

    // Also check active matching surveys
    if (posthog.getActiveMatchingSurveys) {
      posthog.getActiveMatchingSurveys(function(surveys) {
        debugLog('FeedbackSurvey', 'Active matching surveys:', surveys);
        const ourSurvey = surveys.find(s => s.id === FEEDBACK_SURVEY_ID);
        if (ourSurvey) {
          debugLog('FeedbackSurvey', 'Our survey is active and matching');
        } else {
          console.warn('[FeedbackSurvey] Our survey not in active matching surveys - may not display');
        }
      }, true); // forceReload = true
    }

    // Start MutationObserver to catch survey element as soon as it's added
    startSurveyObserver();

    // displaySurvey is the recommended method for programmatically showing surveys
    // It shows the survey as a popover in the corner of the screen
    // For API-type surveys, we may need to pass additional options
    posthog.displaySurvey(FEEDBACK_SURVEY_ID, {
      force: true  // Try to force display even if already shown
    });

    // Track that user clicked the feedback button (separate from survey events)
    posthog.capture('feedback_button_clicked', {
      page: window.location.pathname,
      survey_id: FEEDBACK_SURVEY_ID
    });

    debugLog('FeedbackSurvey', 'displaySurvey called successfully');

    // Fallback: Check if the survey DOM element was created after a short delay
    // MutationObserver should catch it faster, but this is a safety net
    setTimeout(function() {
      const surveyElement = document.querySelector('.PostHogSurvey-' + FEEDBACK_SURVEY_ID);
      const anyPostHogSurvey = document.querySelector('[class*="PostHogSurvey"]');
      debugLog('FeedbackSurvey', 'Fallback check - Survey element found:', !!surveyElement);
      debugLog('FeedbackSurvey', 'Fallback check - Any PostHog survey element:', !!anyPostHogSurvey);
      if (!surveyElement && !anyPostHogSurvey) {
        console.warn('[FeedbackSurvey] Survey element not created - displaySurvey may have silently failed');
        stopSurveyObserver(); // Clean up observer if survey never appeared
      }

      // Inject GPRA dark theme CSS into PostHog's shadow DOM (fallback if MutationObserver missed it)
      if (surveyElement && surveyElement.shadowRoot) {
        injectSurveyStyles(surveyElement.shadowRoot);
        stopSurveyObserver();
      } else if (anyPostHogSurvey && anyPostHogSurvey.shadowRoot) {
        injectSurveyStyles(anyPostHogSurvey.shadowRoot);
        stopSurveyObserver();
      }
    }, 500);

  } catch (error) {
    console.error('[FeedbackSurvey] Error displaying survey:', error);
    showFallbackContactInfo();
  }
}

/**
 * Fallback for when PostHog/surveys aren't available
 * Shows a simple message with contact options
 */
function showFallbackContactInfo() {
  // Create a simple modal-like overlay
  const overlay = document.createElement('div');
  overlay.id = 'feedback-fallback-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1f2937;
    border-radius: 8px;
    padding: 24px;
    max-width: 400px;
    margin: 16px;
    color: #f3f4f6;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  `;

  modal.innerHTML = `
    <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 12px;">Get in touch</h3>
    <p style="color: #9ca3af; margin-bottom: 16px;">
      Found a bug? Have a feature request? Want to say hi?
    </p>
    <p style="margin-bottom: 16px;">
      You can reach me on GitHub:
    </p>
    <a href="https://github.com/slshults/gpra-web/issues"
       target="_blank"
       rel="noopener noreferrer"
       style="display: inline-block; padding: 8px 16px; background: #ea580c; color: white; border-radius: 6px; text-decoration: none; margin-bottom: 16px;">
      Open an issue on GitHub
    </a>
    <p style="color: #6b7280; font-size: 0.875rem;">
      Or check the <a href="/about" style="color: #ea580c;">About page</a> for more info.
    </p>
    <button onclick="closeFeedbackFallback()"
            style="margin-top: 16px; padding: 8px 16px; background: #374151; color: white; border: none; border-radius: 6px; cursor: pointer;">
      Close
    </button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close on overlay click (outside modal)
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closeFeedbackFallback();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', handleFeedbackEscape);
}

function handleFeedbackEscape(e) {
  if (e.key === 'Escape') {
    closeFeedbackFallback();
  }
}

function closeFeedbackFallback() {
  const overlay = document.getElementById('feedback-fallback-overlay');
  if (overlay) {
    overlay.remove();
  }
  document.removeEventListener('keydown', handleFeedbackEscape);
}

// Expose to global scope for onclick handlers
window.triggerFeedbackSurvey = triggerFeedbackSurvey;
window.closeFeedbackFallback = closeFeedbackFallback;
