import React, { useState } from 'react';

export default function UnpluggedAccessModal({ isOpen, onClose, daysRemaining, targetPage }) {
  const [loading, setLoading] = useState(false);

  const handlePlugItBackIn = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/resume-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900 bg-opacity-75"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Still unplugged</h2>

        <p className="text-gray-700 mb-6">
          We're still saving your {targetPage === 'routines' ? 'routines' : 'items'} for another {daysRemaining || 0} days
          (counting from when you paused, canceled, or missed a payment).
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={handlePlugItBackIn}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
          >
            {loading ? 'Loading...' : 'Plug it back in'}
          </button>
          <button
            onClick={onClose}
            className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition-colors"
          >
            Keep it unplugged
          </button>
        </div>
      </div>
    </div>
  );
}
