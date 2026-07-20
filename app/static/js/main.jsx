// app/static/js/main.jsx
import '../css/input.css'
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { NavigationProvider, useNavigation } from '@contexts/NavigationContext';
import { PracticeItemsList } from '@components/PracticeItemsList';
import { PracticePage } from '@components/PracticePage';
import NavMenu from '@components/NavMenu';
import RoutinesPage from '@components/RoutinesPage';
import ImportsPage from '@components/ImportsPage';
import AccountSettings from '@components/AccountSettings';
import GuidedTour from '@components/GuidedTour';
import LapsedSubscriptionModal from '@components/LapsedSubscriptionModal';
import UnpluggedAccessModal from '@components/UnpluggedAccessModal';
import CookieConsent from '@components/CookieConsent';
import DeletionBanner from '@components/DeletionBanner';
import ImpersonationBanner from '@components/ImpersonationBanner';
import KofiWidget from '@components/KofiWidget';
import AutocreateWatcher from '@components/AutocreateWatcher';
import StatsPage from '@components/StatsPage';
import ErrorBoundary from '@components/ErrorBoundary';
import MobileTabBar, { TAB_BAR_HEIGHT } from '@components/MobileTabBar';
import { useLightweightItems } from '@hooks/useLightweightItems';
import { useIsMobile } from '@hooks/useIsMobile';
import { setUserContext } from './utils/analytics';

// Initialize rate limit handling (intercepts fetch for 429 errors)
import './utils/rateLimitHandler';

const ItemsPage = () => {
  const { items, refreshItems } = useLightweightItems();
  return <PracticeItemsList items={items} onItemsChange={refreshItems} />;
};

const PageContent = ({ userStatus }) => {
  const { activePage } = useNavigation();

  switch (activePage) {
    case 'Practice':
      return <PracticePage />;
    case 'Routines':
      return <RoutinesPage />;
    case 'Items':
      return <ItemsPage />;
    case 'Stats':
      return <StatsPage userStatus={userStatus} />;
    case 'Imports':
      return <ImportsPage />;
    case 'Account':
      return <AccountSettings />;
    case 'FAQ':
      // Redirect to static FAQ page
      window.location.href = '/faq';
      return null;
    default:
      return <div>Page not implemented yet</div>;
  }
};

const IMPERSONATION_BANNER_HEIGHT = 36; // px - matches py-2 + text-sm single line

const App = () => {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const [showLapsedModal, setShowLapsedModal] = useState(false);
  const [lapsedInfo, setLapsedInfo] = useState({});
  const [userStatus, setUserStatus] = useState(null);
  const { activePage, setActivePage } = useNavigation();
  const [showUnpluggedModal, setShowUnpluggedModal] = useState(false);
  const [unpluggedTarget, setUnpluggedTarget] = useState('');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const isImpersonating = userStatus?.impersonating === true;
  const bannerOffset = isImpersonating ? IMPERSONATION_BANNER_HEIGHT : 0;
  const isMobile = useIsMobile();
  // Reserve room for the fixed bottom tab bar on mobile so page content can
  // scroll clear of it
  const bottomNavPadding = isMobile ? TAB_BAR_HEIGHT + 8 : 0;

  useEffect(() => {
    const updateHeaderHeight = () => {
      // Only measure when the header is actually visible — on mobile Practice
      // it's hidden (offsetHeight 0), and we must not let that corrupt the
      // height used to pad other pages.
      if (headerRef.current && headerRef.current.offsetHeight > 0) {
        const height = headerRef.current.offsetHeight;
        setHeaderHeight(height + 20); // Add 20px buffer
      }
    };

    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    return () => window.removeEventListener('resize', updateHeaderHeight);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setUserStatus(data);

        // Identify user with PostHog if authenticated. Skipped in cookieless
        // mode (no consent): a PII distinct_id would defeat the anonymous
        // server-side hashing.
        if (data.authenticated && window.posthog && !window.__phCookieless) {
          // Use posthog_distinct_id (email or tidalNNNNN) to coordinate with backend
          window.posthog.identify(data.posthog_distinct_id, {
            email: data.email,
            username: data.user,
            subscription_tier: data.tier,
            billing_period: data.billing_period,
            oauth_providers: data.oauth_providers || [],
            last_seen_at: new Date().toISOString()
          });

          // Sign the support widget's identity so tickets stay tied to the verified user
          if (data.posthog_identity_hash && typeof window.posthog.setIdentity === 'function') {
            window.posthog.setIdentity(data.posthog_distinct_id, data.posthog_identity_hash);
          }

          // Cache user context for analytics auto-inclusion
          setUserContext(data);
        }

        // Show modal for ALL lapsed users (on each fresh login)
        // BUT not if they already dismissed it this session via "Unplugged" button
        const dismissedThisSession = sessionStorage.getItem('lapsedModalDismissed') === 'true';
        if (data.is_lapsed && !dismissedThisSession) {
          setLapsedInfo({
            daysUntil90: data.days_until_90,
            lapseDate: data.lapse_date
          });
          setShowLapsedModal(true);
        }
      })
      .catch(err => console.error('Error checking auth status:', err));
  }, []);

  return (
    <div className="min-h-screen">
      {/* Guided Tour Component */}
      <GuidedTour />

      {/* Cookie Consent Banner */}
      <CookieConsent />

      {/* Global autocreate completion watcher - shows modal when user is on a different page */}
      <AutocreateWatcher />

      {/* Ko-fi floating widget - shown only for free/dollarstore/basic tiers, and not on Practice/Routines/Items/Stats.
          Hidden while the mobile More sheet is open so it doesn't float over the sheet. */}
      {userStatus?.tier &&
        !mobileMoreOpen &&
        activePage !== 'Practice' &&
        activePage !== 'Routines' &&
        activePage !== 'Items' &&
        activePage !== 'Stats' && (
          <KofiWidget currentTier={userStatus.tier} bottomOffset={bottomNavPadding} />
        )}

      {/* Lapsed Subscription Modal */}
      <LapsedSubscriptionModal
        isOpen={showLapsedModal}
        onClose={() => setShowLapsedModal(false)}
        daysUntil90={lapsedInfo.daysUntil90}
        lapseDate={lapsedInfo.lapseDate}
      />

      {/* Unplugged Access Modal */}
      <UnpluggedAccessModal
        isOpen={showUnpluggedModal}
        onClose={() => setShowUnpluggedModal(false)}
        daysRemaining={userStatus?.days_remaining}
        targetPage={unpluggedTarget}
      />

      {/* Impersonation Banner - visible to admins impersonating a user */}
      {isImpersonating && (
        <ImpersonationBanner username={userStatus.user} />
      )}

      {/* Fixed Header - offset down when impersonation banner is showing.
          Hidden on mobile Practice, where MobilePracticePage renders its own
          52px top bar in its place (design 2a). */}
      <div ref={headerRef} className="fixed left-0 right-0 z-50 bg-gray-900" style={{top: `${bannerOffset}px`, display: (isMobile && activePage === 'Practice') ? 'none' : undefined}}>
        <div className="container mx-auto px-4 pt-4 pb-1">
          <h1 className="text-2xl sm:text-4xl font-bold text-orange-500 mb-2" data-tour="app-title">Guitar Practice Routine App</h1>
          <NavMenu
            className="mb-0"
            userStatus={userStatus}
            onUnpluggedAttempt={(page) => {
              setUnpluggedTarget(page.toLowerCase());
              setShowUnpluggedModal(true);
            }}
          />
        </div>
      </div>

      {/* Scrollable Content with dynamic top padding to account for fixed header + impersonation banner.
          On mobile Practice the app header is hidden and MobilePracticePage is full-bleed with its own bar. */}
      <div
        className={`pb-4 container mx-auto ${(isMobile && activePage === 'Practice') ? 'px-0' : 'px-4'}`}
        style={{paddingTop: (isMobile && activePage === 'Practice') ? `${bannerOffset}px` : `${headerHeight + bannerOffset}px`}}
      >
        {/* Deletion Banner - shows when account deletion is scheduled */}
        {userStatus?.deletion_scheduled_for && (
          <DeletionBanner
            deletionDate={userStatus.deletion_scheduled_for}
            deletionType={userStatus.deletion_type}
            refundAmount={userStatus.prorated_refund_amount || 0}
          />
        )}

        <PageContent userStatus={userStatus} />
      </div>

      {/* Mobile bottom tab bar (replaces the header nav tabs on <640px) */}
      {isMobile && (
        <MobileTabBar
          userStatus={userStatus}
          onMoreToggle={setMobileMoreOpen}
          onUnpluggedAttempt={(page) => {
            setUnpluggedTarget(page.toLowerCase());
            setShowUnpluggedModal(true);
          }}
        />
      )}

      {/* Footer */}
      <footer
        className="bg-gray-800 border-t border-gray-700 mt-8 py-6"
        style={{ marginBottom: bottomNavPadding ? `${bottomNavPadding}px` : undefined }}
      >
        <div className="container mx-auto px-4 text-center text-sm text-gray-400">
          <div className="space-x-4">
            <a href="/about" className="hover:text-orange-400 transition-colors">
              About
            </a>
            <span>·</span>
            <a href="/faq" className="hover:text-orange-400 transition-colors">
              Help
            </a>
            <span>·</span>
            <a href="/terms" className="hover:text-orange-400 transition-colors">
              Terms
            </a>
            <span>·</span>
            <a href="/privacy" className="hover:text-orange-400 transition-colors">
              Privacy
            </a>
            <span>·</span>
            <a href="/#Account" className="hover:text-orange-400 transition-colors">
              Upgrade
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NavigationProvider>
        <App />
      </NavigationProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
