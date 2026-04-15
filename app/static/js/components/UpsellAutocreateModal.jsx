import React, { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';
import { Button } from '@ui/button';
import { Sparkles } from 'lucide-react';
import { trackChordChartEvent } from '../utils/analytics';

// Modal shown when a free-tier user (without an Anthropic API key) clicks
// the Upload files or YouTube URL columns in the autocreate UI. Manual entry
// still works for them — this only gates the Claude-powered paths.
const UpsellAutocreateModal = ({ isOpen, onClose, trigger }) => {
  useEffect(() => {
    if (isOpen) {
      trackChordChartEvent('autocreate_upsell_modal_shown', { trigger });
    }
  }, [isOpen, trigger]);

  const fireCta = (action) => {
    trackChordChartEvent('autocreate_upsell_cta_clicked', { trigger, action });
  };

  const handleUpgrade = () => {
    fireCta('upgrade');
    onClose();
    window.location.href = '#Account';
  };

  const handleAddApiKey = () => {
    fireCta('add_api_key');
    try {
      sessionStorage.setItem('gpra_expand_api_key', '1');
    } catch (e) {
      // sessionStorage may be unavailable (e.g. private browsing); still navigate
      console.warn('Could not set gpra_expand_api_key flag:', e);
    }
    onClose();
    window.location.href = '#Account';
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" modalName="Autocreate upsell">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-400" />
            Upgrade for full autocreate
          </DialogTitle>
          <DialogDescription className="text-left">
            Upgrade your plan to autocreate chord charts from YouTube lessons and uploaded chord sheets, or add your own Anthropic API key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={handleAddApiKey}
          >
            Add API key
          </Button>
          <Button
            onClick={handleUpgrade}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Upgrade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpsellAutocreateModal;
