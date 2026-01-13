import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { AlertTriangle, Clock, Loader2, Key } from 'lucide-react';

// Exponential backoff for rate limits: 15s -> 30s -> 60s -> 120s (max)
const RATE_LIMIT_BACKOFF_KEY = 'gpra_rate_limit_backoff';
const BASE_WAIT_TIME = 15;
const MAX_WAIT_TIME = 120;

// Get current backoff level from localStorage
const getBackoffLevel = () => {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_BACKOFF_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      // Reset if more than 5 minutes since last rate limit
      if (Date.now() - data.timestamp > 5 * 60 * 1000) {
        return 0;
      }
      return data.level || 0;
    }
  } catch (e) {
    console.warn('Error reading backoff level:', e);
  }
  return 0;
};

// Increment and save backoff level
const incrementBackoffLevel = () => {
  try {
    const currentLevel = getBackoffLevel();
    const newLevel = Math.min(currentLevel + 1, 3); // Cap at level 3 (120s)
    localStorage.setItem(RATE_LIMIT_BACKOFF_KEY, JSON.stringify({
      level: newLevel,
      timestamp: Date.now()
    }));
    return newLevel;
  } catch (e) {
    console.warn('Error saving backoff level:', e);
    return 0;
  }
};

// Reset backoff (call this after successful autocreate)
export const resetRateLimitBackoff = () => {
  try {
    localStorage.removeItem(RATE_LIMIT_BACKOFF_KEY);
  } catch (e) {
    console.warn('Error resetting backoff:', e);
  }
};

// Calculate wait time based on backoff level
const calculateWaitTime = (level) => {
  // 15s, 30s, 60s, 120s
  return Math.min(BASE_WAIT_TIME * Math.pow(2, level), MAX_WAIT_TIME);
};

const ApiErrorModal = ({ isOpen, onClose, error }) => {
  const [countdown, setCountdown] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);

  // Parse error to determine type and base info (without incrementing backoff)
  const getErrorType = (error) => {
    const errorMsg = error?.message || error || '';
    const errorMsgLower = errorMsg.toLowerCase();

    if (errorMsgLower.includes('529') || errorMsgLower.includes('overloaded')) {
      return {
        type: 'overload',
        title: 'API Temporarily Overloaded',
        message: 'The AI servers are experiencing high traffic right now.',
        waitTime: 30,
        icon: <Loader2 className="h-6 w-6 text-yellow-500 animate-spin" />
      };
    }

    if (errorMsgLower.includes('429') || errorMsgLower.includes('rate limit')) {
      return {
        type: 'rate_limit',
        title: 'Oops!',
        message: null,
        waitTime: null, // Will be calculated with backoff
        icon: <Clock className="h-6 w-6 text-orange-500" />
      };
    }

    if (errorMsgLower.includes('500') || errorMsgLower.includes('502') || errorMsgLower.includes('503')) {
      return {
        type: 'server_error',
        title: 'Server Error',
        message: 'The server is experiencing issues. Let\'s try again in a moment.',
        waitTime: 45,
        icon: <AlertTriangle className="h-6 w-6 text-red-500" />
      };
    }

    if (errorMsgLower.includes('timeout')) {
      return {
        type: 'timeout',
        title: 'Request Timeout',
        message: 'The analysis took too long. This might work better with smaller files.',
        waitTime: 15,
        icon: <Clock className="h-6 w-6 text-blue-500" />
      };
    }

    return {
      type: 'generic',
      title: 'Oops!',
      message: error?.message || error || 'An unexpected error occurred.',
      waitTime: 10,
      icon: <AlertTriangle className="h-6 w-6 text-gray-500" />
    };
  };

  // Initialize countdown when modal opens - only increment backoff once here
  useEffect(() => {
    if (isOpen && error) {
      const baseInfo = getErrorType(error);

      // For rate limits, calculate wait time with exponential backoff
      let waitTime = baseInfo.waitTime;
      if (baseInfo.type === 'rate_limit') {
        const currentLevel = getBackoffLevel();  // Get current (starts at 0)
        waitTime = calculateWaitTime(currentLevel);  // Calculate first (15s for level 0)
        incrementBackoffLevel();  // Then increment for next time
      }

      const finalErrorInfo = { ...baseInfo, waitTime };
      setErrorInfo(finalErrorInfo);
      setCountdown(waitTime);
      setCanRetry(false);

      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setCanRetry(true);
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isOpen, error]);

  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const handleRetry = () => {
    setCanRetry(false);
    setCountdown(0);
    onClose();
  };

  if (!isOpen || !error) return null;

  // Wait for errorInfo to be set by useEffect
  if (!errorInfo) return null;

  // Check if this is an API key required error
  const requiresApiKey = error?.requiresApiKey || false;

  // Special handling for API key required errors
  if (requiresApiKey) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-6 w-6 text-orange-500" />
              API Key Required
            </DialogTitle>
            <DialogDescription className="text-left space-y-3">
              <p>{error.message}</p>

              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Add your Anthropic API key in Account Settings to use the autocreate feature.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onClose();
                window.location.href = '#Account';
              }}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Go to Account Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => open || handleRetry()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {errorInfo.icon}
            {errorInfo.title}
          </DialogTitle>
          <DialogDescription className="text-left space-y-3">
            {errorInfo.type === 'rate_limit' ? (
              <p>
                We've hit Anthropic's rate limit{' '}
                <a
                  href="/faq?expand=autocreate-limits"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open('/faq?expand=autocreate-limits', '_blank');
                  }}
                  className="text-blue-500 hover:text-blue-400 underline"
                >
                  (more info)
                </a>
              </p>
            ) : (
              <p>{errorInfo.message}</p>
            )}

            {countdown > 0 ? (
              <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>Please wait {formatTime(countdown)} before trying again</span>
                </div>
                <div className="w-full bg-gray-300 dark:bg-gray-600 rounded-full h-2 mt-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-1000"
                    style={{
                      width: `${((errorInfo.waitTime - countdown) / errorInfo.waitTime) * 100}%`
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                <p className="text-sm text-green-700 dark:text-green-300">
                  Ready to try again!
                </p>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            onClick={handleRetry}
            disabled={!canRetry}
            className="min-w-20"
          >
            {canRetry ? 'OK' : `Wait ${formatTime(countdown)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApiErrorModal;