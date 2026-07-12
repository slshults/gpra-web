import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Cookie,
  PartyPopper,
  Play,
  ListMusic,
  ListPlus,
  Settings,
  Shield,
  HelpCircle,
} from 'lucide-react';
import { enableCookiesForStats } from '@utils/consent';

const NAV_LINKS = [
  { label: 'Practice', href: '/#Practice', Icon: Play },
  { label: 'Choose or work on Routines', href: '/#Routines', Icon: ListMusic },
  { label: 'Add or edit Items', href: '/#Items', Icon: ListPlus },
  { label: 'Settings', href: '/#Account', Icon: Settings },
  { label: 'Privacy', href: '/privacy', Icon: Shield },
  { label: 'Help', href: '/faq', Icon: HelpCircle },
];

/**
 * Second-step modal on the Stats page, after the cookie consent modal:
 * - variant 'accepted': confirms stats tracking is on, after the Enable-cookies reload
 * - variant 'declined': friendly nudge with a change-your-mind opt-in button
 */
const StatsConsentFollowUpModal = ({ variant, onClose }) => {
  const isOpen = variant === 'accepted' || variant === 'declined';
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        modalName={variant === 'accepted' ? 'Stats consent accepted' : 'Stats consent declined'}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {variant === 'accepted' ? (
              <>
                <PartyPopper className="h-6 w-6 text-orange-500" />
                Ok, all set.
              </>
            ) : (
              <>
                <Cookie className="h-6 w-6 text-orange-500" />
                Okay, no worries
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-left text-base mt-2 text-gray-700 dark:text-gray-300">
            {variant === 'accepted' ? (
              <>
                Your stats will be tracked starting with your next practice session.
                <br />
                <br />
                Come back here <strong>after more than one practice session</strong> to
                see some stats.
              </>
            ) : (
              <>
                But in case you decide you might want stats later:
                <br />
                <a
                  href="/privacy#what-i-dont-do"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-600 dark:text-orange-400 hover:underline"
                >
                  I really don't do anything uncool with cookies
                </a>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Where to next?</p>
          <div className="grid grid-cols-2 gap-2">
            {variant === 'declined' && (
              <button
                type="button"
                onClick={enableCookiesForStats}
                style={{ gridColumn: 'span 2' }}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/80 hover:bg-gray-700 hover:border-gray-600 px-3 py-2.5 text-sm text-gray-200 transition-colors"
              >
                <Cookie className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                <span>Okay fine. Give me the cookies and the stats</span>
              </button>
            )}
            {NAV_LINKS.map(({ label, href, Icon }) => (
              <a
                key={href}
                href={href}
                onClick={onClose}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/80 hover:bg-gray-700 hover:border-gray-600 px-3 py-2.5 text-sm text-gray-200 transition-colors"
              >
                <Icon className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                <span>{label}</span>
              </a>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StatsConsentFollowUpModal;
