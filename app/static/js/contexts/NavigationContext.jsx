// app/static/js/contexts/NavigationContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { trackPageVisit } from '../utils/analytics';

const NavigationContext = createContext(undefined);

export const NavigationProvider = ({ children }) => {
  // Initialize from URL hash, or from sessionStorage (for OAuth redirects), or default to 'Practice'
  const getInitialPage = () => {
    // First check URL hash
    let hash = window.location.hash.slice(1).split('?')[0]; // Remove the # and any query params
    const validPages = ['Practice', 'Routines', 'Items', 'Account'];

    // If no valid hash in URL, check sessionStorage for saved hash from before login redirect
    // This handles the case where user was redirected to login from a deep link (e.g., /#Account)
    if (!validPages.includes(hash)) {
      const savedHash = sessionStorage.getItem('gpra_login_redirect_hash');
      if (savedHash) {
        sessionStorage.removeItem('gpra_login_redirect_hash');
        // Extract just the page name from the saved hash (e.g., "#Account" -> "Account")
        const savedPage = savedHash.replace('#', '').split('?')[0];
        if (validPages.includes(savedPage)) {
          // Update the URL to include the hash (for bookmarking and browser history)
          window.history.replaceState(null, '', `/${savedHash}`);
          return savedPage;
        }
      }
    }

    return validPages.includes(hash) ? hash : 'Practice';
  };

  const [activePage, setActivePage] = useState(getInitialPage);

  // Track initial page load with proper SPA pageview
  useEffect(() => {
    // Wait a bit to ensure PostHog is fully loaded
    const timeoutId = setTimeout(() => {
      trackPageVisit(activePage, {
        initial_page_load: true,
        referrer: document.referrer
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  // Enhanced setActivePage that includes analytics tracking and URL sync
  const setActivePageWithTracking = (pageName, updateHistory = true) => {
    const previousPage = activePage;
    setActivePage(pageName);

    // Track navigation with previous page context
    trackPageVisit(pageName, {
      previous_page: previousPage,
      navigation_type: updateHistory ? 'user_action' : 'browser_navigation',
      timestamp: new Date().toISOString()
    });

    // Update URL hash to reflect current page
    if (updateHistory) {
      window.history.pushState(null, '', `#${pageName}`);
    }
  };

  // Show/hide PostHog conversations widget based on active page
  // Hide on Practice, Routines, Items to avoid cluttering the practice UI
  // Two-pronged approach: CSS hides widget by default (no flash), JS controls body class + API
  useEffect(() => {
    const hideOnPages = ['Practice', 'Routines', 'Items'];
    const shouldShow = !hideOnPages.includes(activePage);

    // Immediately update body class (CSS handles visibility, no flash)
    if (shouldShow) {
      document.body.classList.add('show-ph-widget');
    } else {
      document.body.classList.remove('show-ph-widget');
    }

    // Also call PostHog API as belt-and-suspenders
    const updateWidget = () => {
      if (window.posthog?.conversations) {
        if (shouldShow) {
          window.posthog.conversations.show();
        } else {
          window.posthog.conversations.hide();
        }
      }
    };

    // Try immediately
    updateWidget();

    // Also retry after a short delay in case PostHog hasn't fully loaded yet
    const timeoutId = setTimeout(updateWidget, 1000);

    return () => clearTimeout(timeoutId);
  }, [activePage]);

  // Listen for browser back/forward button
  useEffect(() => {
    const handlePopState = () => {
      const newPage = getInitialPage();
      // Update state without creating new history entry
      setActivePageWithTracking(newPage, false);
    };

    window.addEventListener('popstate', handlePopState);

    // Cleanup listener
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return (
    <NavigationContext.Provider value={{
      activePage,
      setActivePage: setActivePageWithTracking
    }}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
