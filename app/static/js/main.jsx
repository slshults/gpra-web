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
import { useLightweightItems } from '@hooks/useLightweightItems';

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
    default:
      return <div>Page not implemented yet</div>;
  }
};

const App = () => {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const [showLapsedModal, setShowLapsedModal] = useState(false);
  const [lapsedInfo, setLapsedInfo] = useState({});
  const [userStatus, setUserStatus] = useState(null);
  const { activePage, setActivePage } = useNavigation();
  const [showUnpluggedModal, setShowUnpluggedModal] = useState(false);
  const [unpluggedTarget, setUnpluggedTarget] = useState('');

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

      {/* Fixed Header */}
      <div ref={headerRef} className="fixed top-0 left-0 right-0 z-50 bg-gray-900">
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

      {/* Scrollable Content with dynamic top padding to account for fixed header */}
      <div className="pb-4 px-4 container mx-auto" style={{paddingTop: `${headerHeight}px`}}>
        <PageContent />
      </div>
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
