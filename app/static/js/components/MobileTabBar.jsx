// app/static/js/components/MobileTabBar.jsx
// Fixed bottom tab bar for mobile (<640px), from the mobile redesign handoff:
// 60px bar, icon + 10px label per tab, active tab orange. "More" opens a small
// sheet with the destinations that used to live in the desktop header
// (Stats for paid tiers, Account settings, Logout).
import React, { useState } from 'react';
import { PlayCircle, ListMusic, Library, MoreHorizontal, BarChart3, Settings, LogOut } from 'lucide-react';
import { useNavigation } from '@contexts/NavigationContext';
import { useAuth } from '@hooks/useAuth';

const TAB_BAR_HEIGHT = 60;

const TABS = [
  { page: 'Practice', label: 'Practice', Icon: PlayCircle, tour: 'practice-tab' },
  { page: 'Routines', label: 'Routines', Icon: ListMusic, tour: 'routines-tab' },
  { page: 'Items', label: 'Items', Icon: Library, tour: 'items-tab' },
];

// Pages reached through the More sheet — the More tab lights up while on them
const MORE_PAGES = ['Stats', 'Account', 'Imports'];

// Standalone pages that live in the desktop footer, which is hidden on mobile
const STATIC_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'Help' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

const MobileTabBar = ({ userStatus, onUnpluggedAttempt, onMoreToggle }) => {
  const { activePage, setActivePage } = useNavigation();
  const { handleLogout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const isFree = userStatus?.tier === 'free';

  // Keep the parent informed so it can suppress other floating widgets (Ko-fi)
  // that would otherwise overlap the open sheet
  const setMore = (open) => {
    setMoreOpen(open);
    onMoreToggle?.(open);
  };

  const navigate = (page) => {
    setMore(false);
    // Same unplugged-mode gating as the desktop NavMenu
    if (userStatus?.unplugged_mode && ['Routines', 'Items', 'Stats'].includes(page)) {
      onUnpluggedAttempt?.(page);
      return;
    }
    setActivePage(page);
  };

  const moreItems = [
    ...(isFree ? [] : [{ page: 'Stats', label: 'Stats', Icon: BarChart3 }]),
    { page: 'Account', label: 'Account settings', Icon: Settings },
  ];

  const tabStyle = { minWidth: '64px', height: '100%' };
  const labelStyle = { fontSize: '10px', lineHeight: 1 };

  return (
    <>
      {/* Scrim + sheet for the More menu */}
      {moreOpen && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 59, backgroundColor: 'rgba(2, 8, 23, 0.6)' }}
          onClick={() => setMore(false)}
        >
          <div
            className="fixed left-0 right-0 bg-gray-900 border-t border-gray-700"
            style={{ bottom: `${TAB_BAR_HEIGHT}px`, borderRadius: '12px 12px 0 0', padding: '8px 10px 10px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {moreItems.map(({ page, label, Icon }) => (
              <button
                key={page}
                type="button"
                onClick={() => navigate(page)}
                className={`flex items-center gap-3 w-full text-left text-sm ${activePage === page ? 'text-orange-400 font-semibold' : 'text-gray-300'}`}
                style={{ height: '52px', padding: '0 8px' }}
                data-ph-capture-attribute-nav={`mobile-more-${page.toLowerCase()}`}
              >
                <Icon size={20} aria-hidden="true" />
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 w-full text-left text-sm text-gray-400"
              style={{ height: '52px', padding: '0 8px' }}
              data-ph-capture-attribute-button="mobile-more-logout"
            >
              <LogOut size={20} aria-hidden="true" />
              Logout
            </button>

            {/* The standalone pages, moved off the page footer. No Upgrade link —
                it just points at Account settings, which is already above. */}
            <div
              className="flex flex-wrap justify-center text-xs text-gray-500 border-t border-gray-700"
              style={{ gap: '10px', paddingTop: '12px', marginTop: '4px' }}
            >
              {STATIC_LINKS.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  className="hover:text-orange-400 transition-colors"
                  style={{ padding: '6px 2px' }}
                  data-ph-capture-attribute-nav={`mobile-more-${label.toLowerCase()}`}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav
        className="fixed left-0 right-0 bottom-0 flex items-stretch justify-around border-t border-gray-800"
        style={{
          height: `${TAB_BAR_HEIGHT}px`,
          zIndex: 60,
          backgroundColor: 'rgba(17, 24, 39, 0.97)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        aria-label="Primary"
      >
        {TABS.map(({ page, label, Icon, tour }) => {
          const active = activePage === page && !moreOpen;
          return (
            <button
              key={page}
              type="button"
              onClick={() => navigate(page)}
              className={`flex flex-col items-center justify-center gap-1 ${active ? 'text-orange-500 font-bold' : 'text-gray-400'}`}
              style={tabStyle}
              aria-current={active ? 'page' : undefined}
              data-tour={tour}
              data-ph-capture-attribute-nav={`nav-${page.toLowerCase()}`}
            >
              <Icon size={20} aria-hidden="true" />
              <span style={labelStyle}>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(!moreOpen)}
          className={`flex flex-col items-center justify-center gap-1 ${moreOpen || MORE_PAGES.includes(activePage) ? 'text-orange-500 font-bold' : 'text-gray-400'}`}
          style={tabStyle}
          aria-expanded={moreOpen}
          data-ph-capture-attribute-nav="nav-more"
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          <span style={labelStyle}>More</span>
        </button>
      </nav>
    </>
  );
};

export { TAB_BAR_HEIGHT };
export default MobileTabBar;
