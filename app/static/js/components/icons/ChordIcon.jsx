import React from 'react';

/**
 * ChordIcon - A simplified C chord diagram icon
 * Displays a minimal guitar chord chart with fretboard grid and finger positions
 */
export const ChordIcon = ({ className = "h-5 w-5", title = "Chord chart" }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      {/* Fret lines (horizontal) */}
      <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="10" x2="20" y2="10" stroke="currentColor" strokeWidth="0.8" />
      <line x1="4" y1="14" x2="20" y2="14" stroke="currentColor" strokeWidth="0.8" />
      <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="0.8" />

      {/* String lines (vertical) - 6 strings */}
      <line x1="7" y1="6" x2="7" y2="18" stroke="currentColor" strokeWidth="0.5" />
      <line x1="10" y1="6" x2="10" y2="18" stroke="currentColor" strokeWidth="0.5" />
      <line x1="13" y1="6" x2="13" y2="18" stroke="currentColor" strokeWidth="0.5" />
      <line x1="16" y1="6" x2="16" y2="18" stroke="currentColor" strokeWidth="0.5" />
      <line x1="19" y1="6" x2="19" y2="18" stroke="currentColor" strokeWidth="0.5" />
      <line x1="4" y1="6" x2="4" y2="18" stroke="currentColor" strokeWidth="0.5" />

      {/* X mark on 6th string (low E - not played) */}
      <line x1="3" y1="3" x2="5" y2="5" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="3" x2="3" y2="5" stroke="currentColor" strokeWidth="1" />

      {/* C chord finger positions (dots) */}
      {/* A string (5th) - 3rd fret */}
      <circle cx="7" cy="14" r="1.5" fill="currentColor" />

      {/* D string (4th) - 2nd fret */}
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />

      {/* B string (2nd) - 1st fret */}
      <circle cx="16" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
};
