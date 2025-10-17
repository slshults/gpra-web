// components/AuthButton.jsx
import React from 'react';
import { Button } from '@ui/button';
import { useAuth } from '@hooks/useAuth';
import { useNavigation } from '@contexts/NavigationContext';
import { Loader2, LogOut, Settings } from 'lucide-react';

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
          <Button
            onClick={() => setActivePage('Account')}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-gray-200 h-auto py-1"
          >
            <Settings className="mr-2 h-4 w-4" />
            Account
          </Button>
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-gray-200 h-auto py-1"
          >
            logout
          </Button>
        </div>
      ) : (
        <Button
          onClick={handleLogin}
          variant="default"
          className="bg-blue-600 hover:bg-blue-700 text-gray-100"
          disabled={checking}
        >
          {checking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking auth...
            </>
          ) : error ? (
            "Auth Error - Click to retry"
          ) : (
            <>
              <LogOut className="mr-2 h-4 w-4" />
              Let me in
            </>
          )}
        </Button>
      )}
    </div>
  );
};

export default AuthButton;

