// app/static/js/components/NavMenu.jsx
import React from 'react';
import { Button } from '@ui/button';
import { cn } from '@lib/utils';
import AuthButton from './AuthButton';
import { useNavigation } from '@contexts/NavigationContext';
import { useIsMobile } from '@hooks/useIsMobile';

const NavMenu = ({ className, userStatus, onUnpluggedAttempt }) => {
  const { activePage, setActivePage } = useNavigation();
  const isFree = userStatus?.tier === 'free';
  const isMobile = useIsMobile();
  const navItems = isFree
    ? ['Practice', 'Routines', 'Items']
    : ['Practice', 'Routines', 'Items', 'Stats'];

  // The guided tour targets these by data-tour attr. On mobile the tabs here
  // are hidden (display:none) and the visible copies live in MobileTabBar, so
  // drop the attrs on mobile to avoid the tour spotlighting a zero-size hidden
  // element (querySelector would match this DOM-earlier hidden copy first).
  const TOUR_ATTRS = { Practice: 'practice-tab', Routines: 'routines-tab', Items: 'items-tab' };
  const tourAttr = (item) => (isMobile ? undefined : TOUR_ATTRS[item]);

  const handleNavClick = (item) => {
    // Check if user is in unplugged mode and trying to access restricted pages
    if (userStatus?.unplugged_mode && (item === 'Routines' || item === 'Items' || item === 'Stats')) {
      // Prevent navigation and show modal
      onUnpluggedAttempt?.(item);
      return;
    }

    // Normal navigation
    setActivePage(item);
  };

  return (
    <nav className={cn("flex flex-wrap items-center gap-2 sm:gap-4", className)} aria-label="Main navigation">
      {/* Page tabs live in the fixed bottom tab bar on mobile (<640px); hide
          them here so the header stays compact. Auth button stays visible. */}
      <div className="hidden sm:flex flex-wrap gap-2 sm:gap-4">
        {navItems.map((item) => (
          <Button
            key={item}
            variant={activePage === item ? "secondary" : "ghost"}
            className={cn(
              "text-base py-3 px-4 sm:text-xl sm:py-6 sm:px-8",
              activePage === item ? "bg-secondary hover:bg-secondary/90" : "hover:bg-accent"
            )}
            onClick={() => handleNavClick(item)}
            aria-current={activePage === item ? "page" : undefined}
            data-tour={tourAttr(item)}
            data-ph-capture-attribute-nav={`nav-${item.toLowerCase()}`}
          >
            {item}
          </Button>
        ))}
        <Button
          variant={activePage === 'Account' ? "secondary" : "ghost"}
          className={cn(
            "text-base py-3 px-4 sm:text-xl sm:py-6 sm:px-8",
            activePage === 'Account' ? "bg-secondary hover:bg-secondary/90" : "hover:bg-accent",
            "hidden"
          )}
          onClick={() => setActivePage('Account')}
          aria-current={activePage === 'Account' ? "page" : undefined}
          data-tour="account-tab"
        >
          Account
        </Button>
      </div>
      <AuthButton />
    </nav>
  );
};

export default NavMenu;