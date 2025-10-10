// app/static/js/hooks/useRoutineEditor.js
import { useState, useEffect, useMemo, useCallback } from 'react';

export const useRoutineEditor = (routineId = null, initialRoutineDetails = null, availableItems = []) => {
  const [selectedItems, setSelectedItems] = useState([]);
  const [itemDetails, setItemDetails] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize with provided details or fetch them
  useEffect(() => {
    if (initialRoutineDetails?.items) {
      setSelectedItems(initialRoutineDetails.items);
      setLoading(false);
    } else if (routineId) {
      fetchRoutine();
    } else {
      setSelectedItems([]);
      setLoading(false);
    }
  }, [routineId, initialRoutineDetails]);

  const fetchRoutine = async () => {
    try {
      const response = await fetch(`/api/routines/${routineId}/details`);
      if (!response.ok) throw new Error('Failed to fetch routine');
      const data = await response.json();

      // Sort items by order (column C)
      const sortedItems = data.items.sort((a, b) => 
        parseInt(a.routineEntry['C']) - parseInt(b.routineEntry['C'])
      );
      
      setSelectedItems(sortedItems);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter available items based on search query and exclude selected items
  const filteredItems = useMemo(() => {
    // Get Item IDs from routine entries (column B)
    const selectedItemIds = new Set(selectedItems.map(item => item.itemDetails?.['B'] || item.routineEntry?.['B']));
    const filtered = availableItems.filter(item => {
      const isSelected = selectedItemIds.has(item['B']);  // Column B is Item ID
      // Normalize apostrophes in both search term and title for consistent matching
      const normalizeApostrophes = (str) => str.replace(/[''`]/g, "'");
      const title = item['C'] || '';
      const normalizedTitle = normalizeApostrophes(title.toLowerCase());
      const normalizedSearch = normalizeApostrophes(searchQuery.toLowerCase());
      const matchesSearch = normalizedTitle.includes(normalizedSearch);  // Column C is Title
      return !isSelected && matchesSearch;
    });
    return filtered;
  }, [availableItems, selectedItems, searchQuery]);

  const addToRoutine = async (routineId, itemId) => {
    try {
      const response = await fetch(`/api/routines/${routineId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });

      if (!response.ok) throw new Error('Failed to add item to routine');
      
      // Refresh the routine to get updated items
      await fetchRoutine();
      return true;
    } catch (err) {
      console.error('Error adding item:', err);
      return false;
    }
  };

  const removeFromRoutine = async (routineId, routineEntryId) => {
    try {
      const response = await fetch(`/api/routines/${routineId}/items/${routineEntryId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to remove item from routine');
      }
      
      // Update local state immediately for better UX
      setSelectedItems(prev => prev.filter(item => item.routineEntry['A'] !== routineEntryId));
      
      return true;
    } catch (err) {
      console.error('Error removing item:', err);
      return false;
    }
  };

  const updateRoutineOrder = async (routineId, items) => {
    try {

      // Extract only the routine entry data for reordering
      const routineEntries = items.map(item => ({
        'A': item['A'],           // Routine entry ID
        'C': item['C']           // Order in routine
      }));


      const url = `/api/routines/${routineId}/order`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(routineEntries)
      });


      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Order update failed:', errorData);
        throw new Error(errorData.message || 'Failed to update routine order');
      }


      // Refresh the routine to get updated items from server
      await fetchRoutine();

      return true;
    } catch (err) {
      console.error('Error updating routine order:', err);
      return false;
    }
  };

  return {
    availableItems: filteredItems,
    selectedItems,
    setSelectedItems,
    searchQuery,
    setSearchQuery,
    loading,
    error,
    addToRoutine,
    removeFromRoutine,
    updateRoutineOrder,
  };
};