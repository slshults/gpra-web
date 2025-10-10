import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { AlertTriangle, Clock, Loader2 } from 'lucide-react';

const ApiErrorModal = ({ isOpen, onClose, error }) => {
  const [countdown, setCountdown] = useState(0);
  const [canRetry, setCanRetry] = useState(false);

  // Parse error to determine wait time and message
  const parseError = (error) => {
    const errorMsg = error?.message || error || '';
    
    if (errorMsg.includes('529') || errorMsg.includes('overloaded')) {
      return {
        type: 'overload',
        title: 'API Temporarily Overloaded',
        message: 'The AI servers are experiencing high traffic right now.',
        waitTime: 30, // 30 seconds for overload
        icon: <Loader2 className="h-6 w-6 text-yellow-500 animate-spin" />
      };
    }
    
    if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
      return {
        type: 'rate_limit',
        title: 'Rate Limit Reached',
        message: 'You\'ve hit the API rate limit. Please wait before trying again.',
        waitTime: 60, // 60 seconds for rate limit
        icon: <Clock className="h-6 w-6 text-orange-500" />
      };
    }
    
    if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
      return {
        type: 'server_error',
        title: 'Server Error',
        message: 'The server is experiencing issues. Let\'s try again in a moment.',
        waitTime: 45, // 45 seconds for server errors
        icon: <AlertTriangle className="h-6 w-6 text-red-500" />
      };
    }
    
    if (errorMsg.includes('timeout')) {
      return {
        type: 'timeout',
        title: 'Request Timeout',
        message: 'The analysis took too long. This might work better with smaller files.',
        waitTime: 15, // 15 seconds for timeout
        icon: <Clock className="h-6 w-6 text-blue-500" />
      };
    }
    
    // Generic error
    return {
      type: 'generic',
      title: 'Something Went Wrong',
      message: errorMsg || 'An unexpected error occurred.',
      waitTime: 10, // 10 seconds for generic errors
      icon: <AlertTriangle className="h-6 w-6 text-gray-500" />
    };
  };

  const errorInfo = parseError(error);

  // Initialize countdown when modal opens
  useEffect(() => {
    if (isOpen && error) {
      setCountdown(errorInfo.waitTime);
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
  }, [isOpen, error, errorInfo.waitTime]);

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => open || handleRetry()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {errorInfo.icon}
            {errorInfo.title}
          </DialogTitle>
          <DialogDescription className="text-left space-y-3">
            <p>{errorInfo.message}</p>
            
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