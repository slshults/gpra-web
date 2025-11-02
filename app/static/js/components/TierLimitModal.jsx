import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { AlertCircle } from 'lucide-react';

const TierLimitModal = ({ isOpen, onClose, limitType, currentTier, currentCount, limitAmount }) => {
  if (!isOpen) return null;

  const getMessage = () => {
    if (limitType === 'routines') {
      return `Your plan only includes ${limitAmount} routine${limitAmount !== 1 ? 's' : ''}, you're at the max. Pick a button:`;
    } else {
      return `Your plan only includes ${limitAmount} item${limitAmount !== 1 ? 's' : ''}, you're at the max. Pick a button:`;
    }
  };

  const handleUpgrade = () => {
    onClose();
    // Navigate to Account/Settings page using hash routing
    window.location.hash = '#Account';

    // Wait for navigation and DOM update, then scroll to subscription plans section
    setTimeout(() => {
      const subscriptionSection = document.getElementById('subscription-plans');
      if (subscriptionSection) {
        // Get element position and scroll with offset to keep heading visible
        const elementPosition = subscriptionSection.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - 100; // 100px offset for header

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <AlertCircle className="h-6 w-6 text-amber-500" />
            Oops!
          </DialogTitle>
          <DialogDescription className="text-left space-y-3 text-base mt-4">
            <div className="text-gray-700 dark:text-gray-300">
              {getMessage()}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 mt-6">
          <Button
            onClick={handleUpgrade}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
          >
            Upgrade
          </Button>
          <Button
            onClick={onClose}
            className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition-colors dark:bg-gray-600 dark:hover:bg-gray-700 dark:text-gray-200"
          >
            Nope
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TierLimitModal;
