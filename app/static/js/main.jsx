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
import { useLightweightItems } from '@hooks/useLightweightItems';
import { setUserContext } from './utils/analytics';

// Initialize rate limit handling (intercepts fetch for 429 errors)
import './utils/rateLimitHandler';

const ItemsPage = () => {
  const { items, refreshItems } = useLightweightItems();
  return <PracticeItemsList items={items} onItemsChange={refreshItems} />;
};

const PageContent = () => {
  const { activePage } = useNavigation();

  switch (activePage) {
    case 'Practice':
      return <PracticePage />;
    case 'Routines':
      return <RoutinesPage />;
    case 'Items':
      return <ItemsPage />;
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

  const isImpersonating = userStatus?.impersonating === true;
  const bannerOffset = isImpersonating ? IMPERSONATION_BANNER_HEIGHT : 0;

  useEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
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

        // Identify user with PostHog if authenticated
        if (data.authenticated && window.posthog) {
          // Use posthog_distinct_id (email or tidalNNNNN) to coordinate with backend
          window.posthog.identify(data.posthog_distinct_id, {
            email: data.email,
            username: data.user,
            subscription_tier: data.tier,
            billing_period: data.billing_period,
            oauth_providers: data.oauth_providers || []
          });

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

      {/* Fixed Header - offset down when impersonation banner is showing */}
      <div ref={headerRef} className="fixed left-0 right-0 z-50 bg-gray-900" style={{top: `${bannerOffset}px`}}>
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

      {/* Scrollable Content with dynamic top padding to account for fixed header + impersonation banner */}
      <div className="pb-4 px-4 container mx-auto" style={{paddingTop: `${headerHeight + bannerOffset}px`}}>
        {/* Deletion Banner - shows when account deletion is scheduled */}
        {userStatus?.deletion_scheduled_for && (
          <DeletionBanner
            deletionDate={userStatus.deletion_scheduled_for}
            deletionType={userStatus.deletion_type}
            refundAmount={userStatus.prorated_refund_amount || 0}
          />
        )}

        <PageContent />
      </div>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-8 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-gray-400">
          <div className="space-x-4">
            <a href="/about" className="hover:text-orange-400 transition-colors">
              About
            </a>
            <span>·</span>
            <a href="/faq" className="hover:text-orange-400 transition-colors">
              FAQ
            </a>
            <span>·</span>
            <a href="/terms" className="hover:text-orange-400 transition-colors">
              Terms
            </a>
            <span>·</span>
            <a href="/privacy" className="hover:text-orange-400 transition-colors">
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NavigationProvider>
      <App />
    </NavigationProvider>
  </React.StrictMode>
);
