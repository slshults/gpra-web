import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';
import { Button } from '@ui/button';
import { AlertTriangle, Zap } from 'lucide-react';
import { useNavigation } from '@contexts/NavigationContext';
import { useActiveRoutine } from '@hooks/useActiveRoutine';
import { trackChordChartEvent } from '../utils/analytics';
import { debugLog } from '../utils/logging';

/**
 * Global watcher for autocreate completions.
 * Mounted once in main.jsx (inside NavigationProvider).
 * Listens for 'autocreate-complete' CustomEvents from autocreateStore.
 * Shows a navigation modal when completions happen while the user is on a different page.
 */
const AutocreateWatcher = () => {
  const [showModal, setShowModal] = useState(false);
  const [completionData, setCompletionData] = useState(null);
  const { setActivePage } = useNavigation();
  const { routine } = useActiveRoutine();

  const handleCompletion = useCallback((event) => {
    const { itemId, status, result, handledInline } = event.detail;

    debugLog('WATCHER', 'autocreate-complete event:', { itemId, status, handledInline });

    // If the originating page already showed a modal, skip
    if (handledInline) return;

    // Store the completion data and show the global modal
    setCompletionData({ itemId, status, result });
    setShowModal(true);
  }, []);

  useEffect(() => {
    window.addEventListener('autocreate-complete', handleCompletion);
    return () => window.removeEventListener('autocreate-complete', handleCompletion);
  }, [handleCompletion]);

  const handleDismiss = () => {
    setShowModal(false);
    setCompletionData(null);
  };

  const handleGoToItem = () => {
    if (!completionData) return;

    const { itemId, result } = completionData;

    // Check if item is in active routine (match on Column B)
    const routineItem = routine?.items?.find(item => item['B'] === itemId);

    if (routineItem) {
      // Item is in the active routine - navigate to Practice and scroll to it
      sessionStorage.setItem('autocreateScrollTarget', JSON.stringify({
        itemId,
        columnA: routineItem['A']
      }));
      setActivePage('Practice');

      trackChordChartEvent('autocreate_nav_to_item', {
        item_name: result?.itemName,
        destination: 'practice_page'
      });
    } else {
      // Item is not in active routine - navigate to Items and auto-open chord charts
      sessionStorage.setItem('autocreateOpenChordCharts', JSON.stringify({
        itemId,
        itemTitle: result?.itemName || 'Unknown item'
      }));
      setActivePage('Items');

      trackChordChartEvent('autocreate_nav_to_item', {
        item_name: result?.itemName,
        destination: 'items_page'
      });
    }

    setShowModal(false);
    setCompletionData(null);
  };

  if (!showModal || !completionData) return null;

  const { status, result } = completionData;
  const isSuccess = status === 'success';
  const itemName = result?.itemName || 'your item';

  // Check if item is in active routine for display text
  const isInRoutine = routine?.items?.some(item => item['B'] === completionData.itemId);

  return (
    <Dialog open={showModal} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="sm:max-w-md" modalName="Autocreate watcher">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSuccess ? (
              <>
                <Zap className="h-6 w-6 text-yellow-500" />
                Chord charts ready!
              </>
            ) : (
              <>
                <AlertTriangle className="h-6 w-6 text-red-500" />
                Autocreate failed
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-left">
            {isSuccess ? (
              <div className="space-y-2">
                <p>
                  Chord charts have been created for <span className="font-medium text-gray-200">{itemName}</span>.
                </p>
                {result?.chordCount > 0 && (
                  <p className="text-sm text-gray-400">
                    {result.chordCount} chord chart{result.chordCount !== 1 ? 's' : ''} created.
                  </p>
                )}
                {result?.chordLoadFailures > 0 && (
                  <p className="text-sm text-amber-300 bg-amber-900/40 border border-amber-700/60 px-3 py-2 rounded">
                    {result.chordLoadFailures} chord{result.chordLoadFailures === 1 ? '' : 's'} couldn't get here because there was too much traffic on the way to the venue. Please retry.
                  </p>
                )}
              </div>
            ) : (
              <p>
                Something went wrong creating chord charts for <span className="font-medium text-gray-200">{itemName}</span>.
                {result?.error && (
                  <span className="block text-sm text-gray-400 mt-1">{result.error}</span>
                )}
              </p>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 -mt-2">
          <Button onClick={handleDismiss} variant="outline" className="min-w-20">
            Dismiss
          </Button>
          {isSuccess && (
            <Button onClick={handleGoToItem} className="min-w-20">
              {isInRoutine ? 'View on Practice page' : 'View on Items page'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutocreateWatcher;
