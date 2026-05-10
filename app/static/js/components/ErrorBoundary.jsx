import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    if (window.posthog && typeof window.posthog.captureException === 'function') {
      window.posthog.captureException(error, { errorInfo });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-orange-500 mb-3">Something went wrong</h1>
          <p className="text-gray-300 mb-6">
            The app hit an unexpected error. Reloading should clear it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
