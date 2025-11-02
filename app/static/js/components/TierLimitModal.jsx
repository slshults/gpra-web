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
      return `The ${currentTier} tier is limited to ${limitAmount} routine${limitAmount !== 1 ? 's' : ''}. You currently have ${currentCount}.`;
    } else {
      return `The ${currentTier} tier is limited to ${limitAmount} item${limitAmount !== 1 ? 's' : ''}. You currently have ${currentCount}.`;
    }
  };

  const handleUpgrade = () => {
    onClose();
    // Navigate to Account/Settings page using hash routing
    window.location.hash = '#Account';
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
              {getMessage()} Please visit your Account/Settings page to upgrade.
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
