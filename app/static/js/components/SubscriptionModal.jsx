import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { CheckCircle, TrendingUp, RefreshCw, CreditCard } from 'lucide-react';

const SubscriptionModal = ({ isOpen, onClose, title, message, icon }) => {
  if (!isOpen) return null;

  // Choose icon based on title or default to CheckCircle
  const getIcon = () => {
    if (icon) return icon;

    if (title?.includes('Upgraded')) {
      return <TrendingUp className="h-6 w-6 text-green-500" />;
    } else if (title?.includes('Billing Updated')) {
      return <CreditCard className="h-6 w-6 text-blue-500" />;
    } else if (title?.includes('Changed')) {
      return <RefreshCw className="h-6 w-6 text-orange-500" />;
    }
    return <CheckCircle className="h-6 w-6 text-green-500" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {getIcon()}
            {title}
          </DialogTitle>
          <DialogDescription className="text-left space-y-3 text-base mt-4">
            <div className="whitespace-pre-line text-gray-700 dark:text-gray-300">
              {message}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end mt-6">
          <Button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6"
          >
            Got it! 🎸
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SubscriptionModal;