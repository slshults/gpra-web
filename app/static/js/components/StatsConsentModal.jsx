import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Cookie } from 'lucide-react';
import { enableCookiesForStats } from '@utils/consent';

/**
 * Shown on the Stats page when the user hasn't consented to analytics cookies,
 * so PostHog has no practice data to build stats from. Offers to enable cookies
 * (same flow as the consent banner's "Accept all") or dismiss.
 */
const StatsConsentModal = ({ isOpen, onClose }) => {

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        modalName="Stats cookie consent"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Cookie className="h-6 w-6 text-orange-500" />
            Cookies and practice stats
          </DialogTitle>
          <DialogDescription className="text-left text-base mt-4 text-gray-700 dark:text-gray-300">
            Oh, sorry, you haven't allowed cookies yet, so we haven't been able to track
            your practice stats.
            <br />
            <br />
            If you'd like to see stats here in the future, please enable cookies.
            <br />
            <br />
            See our{' '}
            <a
              href="/privacy#cookies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 dark:text-orange-400 hover:underline"
            >
              privacy page
            </a>{' '}
            if you want to know more before enabling them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <Button
            onClick={enableCookiesForStats}
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
          >
            Enable cookies
          </Button>
          <Button
            onClick={onClose}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 font-semibold"
          >
            I'm too paranoid for stats
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StatsConsentModal;
