import { useState, useEffect } from 'react';

export const usePracticeItems = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  // Fetch items from backend
  const fetchItems = async () => {
    try {
      const response = await fetch('/api/items');
      if (!response.ok) {
        throw new Error('Failed to fetch items');
      }
      const data = await response.json();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshItems = async () => {
    setVersion(v => v + 1); // This will trigger the useEffect
  };

  const deleteItem = async (itemId) => {
    try {
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete item');
      }
      // Update local state immediately
      setItems(current => current.filter(item => item['A'] !== itemId));  // Column A for ID
      // Force a refresh to ensure sync
      await refreshItems();
    } catch (err) {
      setError(err.message);
      console.error('Delete error:', err);
      throw err;
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    if (active.id !== over?.id) {
      setSortedItems((items) => {
        const oldIndex = items.findIndex((item) => item['A'] === active.id);  // Column A for ID
        const newIndex = items.findIndex((item) => item['A'] === over.id);    // Column A for ID
        const reordered = arrayMove(items, oldIndex, newIndex);
        
        // Add order field to each item
        const withOrder = reordered.map((item, idx) => ({
          ...item,
          'G': idx  // Column G for order
        }));
        
        // Update backend
        updateItems(withOrder).catch(error => {
          console.error('Failed to update item order:', error);
          // Revert to previous order on error
          setSortedItems(items);
        });
        
        return withOrder;
      });
    }
  };

  // Add new item
  const addItem = async (newItem) => {
    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newItem),
      });
      if (!response.ok) {
        throw new Error('Failed to add item');
      }
      const addedItem = await response.json();
      setItems([...items, addedItem]);
      return addedItem;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  // Update item
  const updateItem = async (itemId, updatedItem) => {
    try {
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedItem),
      });
      if (!response.ok) {
        throw new Error('Failed to update item');
      }
      const updated = await response.json();
      setItems(items.map(item => 
        item['A'] === itemId ? updated : item  // Column A for ID
      ));
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateItems = async (updatedItems) => {
    try {
      const response = await fetch('/api/items/order', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedItems),
      });
      if (!response.ok) {
        throw new Error('Failed to update items');
      }
      const data = await response.json();
      setItems(data);
      await refreshItems();
      return data;
    } catch (err) {
      setError(err.message);
      console.error('Update error:', err);
      throw err;
    }
  };

  // Fetch items on mount and when version changes
  useEffect(() => {
    fetchItems();
  }, [version]);

  return {
    items,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
    updateItems,
    refreshItems
  };
};