// app/static/js/components/NavMenu.jsx
import React from 'react';
import { Button } from '@ui/button';
import { cn } from '@lib/utils';
import AuthButton from './AuthButton';
import { useNavigation } from '@contexts/NavigationContext';

const NavMenu = ({ className, userStatus, onUnpluggedAttempt }) => {
  const { activePage, setActivePage } = useNavigation();
  const navItems = ['Practice', 'Routines', 'Items'];

  const handleNavClick = (item) => {
    // Check if user is in unplugged mode and trying to access restricted pages
    if (userStatus?.unplugged_mode && (item === 'Routines' || item === 'Items')) {
      // Prevent navigation and show modal
      onUnpluggedAttempt?.(item);
      return;
    }

    // Normal navigation
    setActivePage(item);
  };

  return (
    <nav className={cn("flex flex-wrap items-center gap-2 sm:gap-4", className)} aria-label="Main navigation">
      <div className="flex flex-wrap gap-2 sm:gap-4">
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
            data-tour={item === 'Practice' ? 'practice-tab' : item === 'Routines' ? 'routines-tab' : item === 'Items' ? 'items-tab' : undefined}
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