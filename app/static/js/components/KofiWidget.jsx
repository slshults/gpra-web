import { useEffect } from 'react';

const KOFI_USERNAME = 'gprakofi';

const ELIGIBLE_TIERS = ['free', 'dollarstore', 'basic'];

const KofiWidget = ({ currentTier }) => {
  const isEligible = ELIGIBLE_TIERS.includes(currentTier);

  useEffect(() => {
    if (!isEligible) return;

    const script = document.createElement('script');
    script.src = 'https://storage.ko-fi.com/cdn/scripts/overlay-widget.js';
    script.async = true;
    script.onload = () => {
      if (window.kofiWidgetOverlay) {
        window.kofiWidgetOverlay.draw(KOFI_USERNAME, {
          'type': 'floating-chat',
          'floating-chat.donateButton.text': 'Support this app',
          'floating-chat.donateButton.background-color': '#00b9fe',
          'floating-chat.donateButton.text-color': '#fff'
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      script.remove();
      const widget = document.getElementById('kofi-widget-overlay');
      if (widget) widget.remove();
    };
  }, [isEligible]);

  return null;
};

export default KofiWidget;
