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
    default:
      return <div>Page not implemented yet</div>;
  }
};

const App = () => {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);

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

  return (
    <div className="min-h-screen">
      {/* Fixed Header */}
      <div ref={headerRef} className="fixed top-0 left-0 right-0 z-50 bg-gray-900">
        <div className="container mx-auto px-4 pt-4 pb-1">
          <h1 className="text-2xl sm:text-4xl font-bold text-orange-500 mb-2">Guitar Practice Routine App</h1>
          <NavMenu className="mb-0" />
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