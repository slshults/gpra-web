import React from 'react';

/**
 * ImpersonationBanner Component
 *
 * Displays a fixed banner at the very top of the page when an admin
 * is impersonating a user. Shows who is being impersonated and provides
 * a link to stop impersonation (server-side route).
 */
const ImpersonationBanner = ({ username }) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 text-black text-sm font-semibold text-center py-2">
      Impersonating {username} &mdash;{' '}
      <a
        href="/admin/impersonate/stop"
        className="underline font-bold hover:text-white"
      >
        Stop impersonation
      </a>
    </div>
  );
};

export default ImpersonationBanner;
