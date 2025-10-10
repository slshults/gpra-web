import { useState, useEffect } from 'react';

export const useActiveRoutine = () => {
  const [routine, setRoutine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const fetchActiveRoutine = async () => {
    try {
      const response = await fetch('/api/practice/active-routine/lightweight');
      if (!response.ok) {
        throw new Error('Failed to fetch active routine');
      }
      const data = await response.json();
      
      if (!data.active_id) {
        setRoutine(null);
        setError(null);
        setLoading(false);
        return;
      }

      // Sort items by order (column C) to match the Routines page
      const sortedItems = data.items.sort((a, b) =>
        parseInt(a.routineEntry['C']) - parseInt(b.routineEntry['C'])
      );

      setRoutine({
        id: data.active_id,
        name: data.name,
        items: sortedItems.map(item => ({
          ...item.routineEntry,
          // Only include minimal details (title) for collapsed view
          minimalDetails: item.itemMinimal
        }))
      });
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshRoutine = async () => {
    setVersion(v => v + 1);
  };

  // Fetch active routine on mount and when version changes
  useEffect(() => {
    fetchActiveRoutine();
  }, [version]);


  return {
    routine,
    loading,
    error,
    refreshRoutine
  };
}; 