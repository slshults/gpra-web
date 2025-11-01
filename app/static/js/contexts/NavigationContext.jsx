// app/static/js/contexts/NavigationContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { trackPageVisit } from '../utils/analytics';

const NavigationContext = createContext(undefined);

export const NavigationProvider = ({ children }) => {
  // Initialize from URL hash or default to 'Practice'
  const getInitialPage = () => {
    const hash = window.location.hash.slice(1).split('?')[0]; // Remove the # and any query params
    const validPages = ['Practice', 'Routines', 'Items', 'Account'];
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
