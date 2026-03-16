import { useEffect, useState } from 'react';

const KOFI_URL = 'https://ko-fi.com/gprakofi';
const ELIGIBLE_TIERS = ['free', 'dollarstore', 'basic'];

const KofiWidget = ({ currentTier }) => {
  const isEligible = ELIGIBLE_TIERS.includes(currentTier);

  if (!isEligible) return null;

  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Support this app on Ko-fi"
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backgroundColor: '#f45d22',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: '20px',
        textDecoration: 'none',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'transform 0.15s ease',
      }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <img
        src="/static/images/kofi-cup.png"
        alt="Ko-fi"
        style={{ height: '20px', width: 'auto' }}
      />
      Tip Me
    </a>
  );
};

export default KofiWidget;
