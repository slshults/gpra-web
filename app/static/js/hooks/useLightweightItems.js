import { useState, useEffect, useCallback } from 'react';

export const useLightweightItems = () => {
  const [lightweightItems, setLightweightItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  // Fetch full item data for drag and drop support
  const fetchLightweightItems = async () => {
    try {
      const response = await fetch('/api/items');
      if (!response.ok) {
        throw new Error('Failed to fetch items');
      }
      const data = await response.json();
      setLightweightItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshItems = useCallback(async () => {
    setVersion(v => v + 1); // This will trigger the useEffect
  }, []);

  // Fetch items on mount and when version changes
  useEffect(() => {
    fetchLightweightItems();
  }, [version]);

  return {
    items: lightweightItems,
    loading,
    error,
    refreshItems
  };
};