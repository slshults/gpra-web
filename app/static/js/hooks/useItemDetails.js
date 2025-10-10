import { useState, useCallback } from 'react';

export const useItemDetails = () => {
  const [itemDetailsCache, setItemDetailsCache] = useState({});
  const [loadingItems, setLoadingItems] = useState(new Set());
  const [error, setError] = useState(null);

  const fetchItemDetails = useCallback(async (itemId) => {
    // Return cached data if available
    if (itemDetailsCache[itemId]) {
      return itemDetailsCache[itemId];
    }

    // Return early if already loading
    if (loadingItems.has(itemId)) {
      return null;
    }

    try {
      setLoadingItems(prev => new Set([...prev, itemId]));
      setError(null);

      const response = await fetch(`/api/items/${itemId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch item details: ${response.statusText}`);
      }

      const itemDetails = await response.json();
      
      // Cache the result
      setItemDetailsCache(prev => ({
        ...prev,
        [itemId]: itemDetails
      }));

      return itemDetails;
    } catch (err) {
      setError(err.message);
      console.error('Error fetching item details:', err);
      return null;
    } finally {
      setLoadingItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, [itemDetailsCache, loadingItems]);

  const getItemDetails = useCallback((itemId) => {
    return itemDetailsCache[itemId] || null;
  }, [itemDetailsCache]);

  const isLoadingItem = useCallback((itemId) => {
    return loadingItems.has(itemId);
  }, [loadingItems]);

  const clearCache = useCallback(() => {
    setItemDetailsCache({});
    setLoadingItems(new Set());
    setError(null);
  }, []);

  return {
    fetchItemDetails,
    getItemDetails,
    isLoadingItem,
    error,
    clearCache
  };
};