// hooks/useRoutines.js
import { useState, useEffect } from 'react';

export const useRoutines = () => {
  const [routines, setRoutines] = useState([]);
  const [activeRoutine, setActiveRoutine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch all routines
  const fetchRoutines = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/routines');
      if (!response.ok) throw new Error('Failed to fetch routines');
      const data = await response.json();
      setRoutines(data);
      setError(null);
    } catch (err) {
      console.error('Fetch routines error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Create new routine
  const createRoutine = async (name) => {
    try {
      const response = await fetch('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineName: name })
      });
      if (!response.ok) throw new Error('Failed to create routine');
      await fetchRoutines(); // Refresh the list
      return true;
    } catch (err) {
      console.error('Create routine error:', err);
      setError(err.message);
      return false;
    }
  };

  // Delete routine
  const deleteRoutine = async (routineId) => {
    try {
      const response = await fetch(`/api/routines/${routineId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete routine');
      await fetchRoutines(); // Refresh the list
      return true;
    } catch (err) {
      console.error('Delete routine error:', err);
      setError(err.message);
      return false;
    }
  };

  // Set active routine
  const activateRoutine = async (routine) => {
    setActiveRoutine(routine);
    // TODO: Persist active routine state to backend if needed
  };

  // Initial fetch
  useEffect(() => {
    fetchRoutines();
  }, []);

  return {
    routines,
    activeRoutine,
    loading,
    error,
    createRoutine,
    deleteRoutine,
    activateRoutine,
    refreshRoutines: fetchRoutines
  };
};
