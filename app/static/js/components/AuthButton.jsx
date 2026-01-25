// components/AuthButton.jsx
import React from 'react';
import { Button } from '@ui/button';
import { useAuth } from '@hooks/useAuth';
import { useNavigation } from '@contexts/NavigationContext';
import { Loader2, LogOut, Settings } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@ui/tooltip';

const AuthButton = () => {
  const { isAuthenticated, hasSpreadsheetAccess, checking, error, handleLogin, handleLogout } = useAuth();
  const { setActivePage } = useNavigation();

  return (
    <div className="ml-auto flex items-end gap-2">
      {isAuthenticated && !hasSpreadsheetAccess && (
        <span className="text-sm text-red-400">Log in with gmail acct instead</span>
      )}
      {isAuthenticated ? (
        <div className="flex flex-col gap-1 items-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setActivePage('Account')}
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-gray-200 h-auto py-1"
                  aria-label="Account settings"
                  data-ph-capture-attribute-button="account-settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Account/Settings</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-gray-200 h-auto py-1"
            data-ph-capture-attribute-button="logout"
          >
            logout
          </Button>
        </div>
      ) : checking ? (
        // Don't show anything during brief auth check (user is already authenticated or will be redirected to login)
        null
      ) : (
        <Button
          onClick={handleLogin}
          variant="default"
          className="bg-blue-600 hover:bg-blue-700 text-gray-100"
          data-ph-capture-attribute-button="login"
        >
          {error ? (
            "Auth Error - Click to retry"
          ) : (
            <>
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Let me in
            </>
          )}
        </Button>
      )}
    </div>
  );
};

export default AuthButton;

