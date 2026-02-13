import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@hooks/useAuth';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Plus, Pencil, X, CheckCircle2, GripVertical, Search } from 'lucide-react';
import { RoutineEditor } from './RoutineEditor';
import ChordChartsModal from './ChordChartsModal';
import TierLimitModal from './TierLimitModal';
import { ChordIcon } from './icons/ChordIcon';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { trackItemOperation, trackRoutineOperation } from '../utils/analytics';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Sortable item component for active routine items
const SortableItem = React.memo(({ item, itemDetails, handleOpenChordCharts }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.routineEntry?.['A'] || item['A'] });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-4 rounded-lg ${
        isDragging ? 'bg-gray-700' : 'bg-gray-800'
      }`}
    >
      <div className="flex items-center">
        <div {...attributes} {...listeners} aria-label="Drag to reorder item" data-ph-capture-attribute-drag="routine-item-drag-handle">
          <GripVertical className="h-5 w-5 text-gray-500 mr-4 cursor-move" aria-hidden="true" />
        </div>
        <span className="text-lg">{itemDetails?.['C'] || `Item ${item.routineEntry?.['B'] || item['B']}`}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleOpenChordCharts(
            item.routineEntry?.['B'] || item['B'],
            itemDetails?.['C'] || `Item ${item.routineEntry?.['B'] || item['B']}`
          )}
          className="text-blue-400 hover:text-blue-300 hover:bg-gray-700 h-8 w-8"
          title="Click to add or edit chord charts"
          data-ph-capture-attribute-button="routine-item-chord-charts"
        >
          <ChordIcon className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Chord charts</span>
        </Button>
        {(item.routineEntry?.['D'] || item['D']) === 'TRUE' && (
          <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});

// Add SortableInactiveRoutine component near the top with other components
const SortableInactiveRoutine = React.memo(({ routine, handleActivateRoutine, handleEditClick, handleDeleteClick }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: routine.ID });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-3 ${
        isDragging ? 'bg-gray-700' : 'bg-gray-800'
      } rounded-lg`}
    >
      <div className="flex items-center">
        <div {...attributes} {...listeners} aria-label="Drag to reorder routine" data-ph-capture-attribute-drag="routine-drag-handle">
          <GripVertical className="h-5 w-5 text-gray-500 mr-4 cursor-move" aria-hidden="true" />
        </div>
        <span>{routine.name}</span>
      </div>
      <div className="flex space-x-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleActivateRoutine(routine.ID)}
          className="text-green-500 hover:text-green-400"
          title="Make this the active routine"
          data-ph-capture-attribute-button="activate-routine"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Activate routine</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleEditClick(routine)}
          className="text-blue-500 hover:text-blue-400"
          title="Edit routine"
          data-ph-capture-attribute-button="edit-routine"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Edit routine</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-500 hover:text-red-400"
          onClick={() => handleDeleteClick(routine.ID)}
          title="Delete this routine"
          data-ph-capture-attribute-button="delete-routine"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Delete routine</span>
        </Button>
      </div>
    </div>
  );
});

const RoutinesPage = () => {
  const { isAuthenticated, checking } = useAuth();
  const [items, setItems] = useState([]);  // Lazy-loaded when needed
  const [newRoutineName, setNewRoutineName] = useState('');
  const [routines, setRoutines] = useState([]);
  const [routineSearchQuery, setRoutineSearchQuery] = useState('');
  const [showNewRoutineModal, setShowNewRoutineModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [routineToDelete, setRoutineToDelete] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState(null);
  const [error, setError] = useState(null);
  const [activeRoutineItems, setActiveRoutineItems] = useState([]);

  // Chord charts modal state
  const [chordChartsModalOpen, setChordChartsModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedItemTitle, setSelectedItemTitle] = useState('');

  // Tier limit modal state
  const [tierLimitModalOpen, setTierLimitModalOpen] = useState(false);
  const [tierLimitData, setTierLimitData] = useState({
    limitType: 'routines',
    currentTier: 'free',
    currentCount: 0,
    limitAmount: 1,
  });

  // Ref for auto-focusing the new routine name input in the modal
  const newRoutineInputRef = useRef(null);

  // Debounce timer for routine order updates
  const routineOrderDebounceRef = useRef(null);
  const pendingRoutineOrderRef = useRef(null);

  const activeRoutine = useMemo(() => routines.find(r => r.active), [routines]);
  const inactiveRoutines = useMemo(() => 
    routines
      .filter(r => !r.active)
      .sort((a, b) => Number(a.order) - Number(b.order)), 
    [routines]);

  const filteredInactiveRoutines = useMemo(() => {
    if (!routineSearchQuery.trim()) return inactiveRoutines;
    const query = routineSearchQuery.trim().toLowerCase();
    return inactiveRoutines.filter(r => r.name.toLowerCase().includes(query));
  }, [inactiveRoutines, routineSearchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchRoutines = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const response = await fetch('/api/routines');
      if (!response.ok) throw new Error('Failed to fetch routines');
      const routinesList = await response.json();
      setRoutines(routinesList);
    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Lazy-load items only when routine editor is opened
  const fetchItemsIfNeeded = useCallback(async () => {
    if (items.length === 0) {
      try {
        const response = await fetch('/api/items');
        if (!response.ok) throw new Error('Failed to fetch items');
        const itemsData = await response.json();
        setItems(itemsData);
      } catch (error) {
        console.error('Error fetching items:', error);
        setError(error.message);
      }
    }
  }, [items.length]);

  const handleActivateRoutine = useCallback(async (routineId) => {
    try {
      const response = await fetch(`/api/routines/${routineId}/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true })
      });

      if (!response.ok) throw new Error('Failed to activate routine');

      // Fetch fresh routines list
      const routinesResponse = await fetch('/api/routines');
      if (routinesResponse.ok) {
        const freshRoutines = await routinesResponse.json();
        setRoutines(freshRoutines);

        // Fetch active routine items
        const activeRoutine = freshRoutines.find(r => r.active);
        if (activeRoutine) {
          // Track routine activation
          trackRoutineOperation('activated', activeRoutine.Name, null, {
            routine_id: activeRoutine.ID,
            item_count: activeRoutine.ItemCount || 0
          });

          const routineResponse = await fetch(`/api/routines/${activeRoutine.ID}`);
          if (routineResponse.ok) {
            const routineData = await routineResponse.json();
            const sortedItems = routineData.items
              .sort((a, b) => parseInt(a.routineEntry['C']) - parseInt(b.routineEntry['C']))
              .map(item => ({
                ...item,
                itemDetails: item.itemDetails || item
              }));
            setActiveRoutineItems(sortedItems);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
    }
  }, []);

  const handleDeactivateRoutine = useCallback(async (routineId) => {
    try {
      const response = await fetch(`/api/routines/${routineId}/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false })
      });

      if (!response.ok) throw new Error('Failed to deactivate routine');

      // Fetch fresh routines list
      const routinesResponse = await fetch('/api/routines');
      if (routinesResponse.ok) {
        const freshRoutines = await routinesResponse.json();
        setRoutines(freshRoutines);
        setActiveRoutineItems([]); // Clear items when deactivating
      }
    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
    }
  }, []);

  const handleDeleteClick = useCallback((routineId) => {
    setRoutineToDelete(routines.find(r => r.ID === routineId));
  }, [routines]);

  const handleOpenChordCharts = useCallback((itemId, itemTitle) => {
    setSelectedItemId(itemId);
    setSelectedItemTitle(itemTitle);
    setChordChartsModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!routineToDelete) return;
    
    try {
      const response = await fetch(`/api/routines/${routineToDelete.ID}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to delete routine');
      
      // Track routine deletion
      trackItemOperation('deleted', 'routine', routineToDelete.Name);
      
      await fetchRoutines();
    } catch (error) {
      console.error('Failed to delete routine:', error);
      setError(error.message);
    } finally {
      setRoutineToDelete(null);
    }
  }, [routineToDelete, fetchRoutines]);

  const handleCreateRoutine = useCallback(async () => {
    if (!newRoutineName.trim()) return;

    try {
      const response = await fetch('/api/routines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ routineName: newRoutineName.trim() }),
      });

      if (!response.ok) {
        // Check if this is a tier limit error
        if (response.status === 403) {
          const errorData = await response.json();
          if (errorData.error === 'Routine limit reached') {
            setTierLimitData({
              limitType: 'routines',
              currentTier: errorData.tier || 'free',
              currentCount: errorData.current || 0,
              limitAmount: errorData.limit || 1,
            });
            setTierLimitModalOpen(true);
            return;
          }
        }
        throw new Error('Failed to create routine');
      }

      // Track routine creation
      trackItemOperation('created', 'routine', newRoutineName.trim());

      await fetchRoutines();
      setNewRoutineName('');
      setShowNewRoutineModal(false);
    } catch (error) {
      console.error('Failed to create routine:', error);
      setError(error.message);
    }
  }, [newRoutineName, fetchRoutines]);

  const handleEditClick = useCallback(async (routine) => {
    
    // Lazy-load items before opening editor
    await fetchItemsIfNeeded();
    
    // Find the active routine details if this is the active routine
    const routineDetails = routine.active ? {
      id: routine.ID,
      name: routine.name,
      items: activeRoutineItems.map(item => ({
        routineEntry: item.routineEntry || item,  // Extract actual routineEntry or fallback to item
        itemDetails: item.itemDetails
      }))
    } : null;

    setEditingRoutine({
      id: routine.ID,
      name: routine.name,
      details: routineDetails
    });
    setIsEditOpen(true);
  }, [activeRoutineItems, fetchItemsIfNeeded]);

  const handleRoutineChange = useCallback(async () => {
    // Fetch fresh routines list
    const response = await fetch('/api/routines');
    if (!response.ok) {
      console.error('Failed to fetch routines');
      return;
    }

    const freshRoutines = await response.json();
    setRoutines(freshRoutines);

    // Use fresh data to find active routine
    const activeRoutine = freshRoutines.find(r => r.active);

    if (!activeRoutine) {
      setActiveRoutineItems([]);
      return;
    }

    // Fetch the routine with all details
    const routineResponse = await fetch(`/api/routines/${activeRoutine.ID}`);
    if (routineResponse.ok) {
      const routineData = await routineResponse.json();

      // Sort items by order (order is stored in routineEntry.C)
      const sortedItems = routineData.items
        .sort((a, b) => parseInt(a.routineEntry['C']) - parseInt(b.routineEntry['C']))
        .map(item => ({
          ...item,
          itemDetails: item.itemDetails || item
        }));

      setActiveRoutineItems(sortedItems);
    }
  }, []);

  const fetchActiveRoutineItems = useCallback(async () => {
    try {
      // Fetch fresh routines to avoid stale closure
      const routinesResponse = await fetch('/api/routines');
      if (!routinesResponse.ok) throw new Error('Failed to fetch routines');
      const freshRoutines = await routinesResponse.json();

      // Get active routine from fresh data
      const activeRoutine = freshRoutines.find(r => r.active);

      if (!activeRoutine) {
        setActiveRoutineItems([]);
        return;
      }

      // Fetch the routine with all details
      const routineResponse = await fetch(`/api/routines/${activeRoutine.ID}`);
      if (!routineResponse.ok) throw new Error('Failed to fetch routine details');
      const routineData = await routineResponse.json();

      // Sort items by order (order is stored in routineEntry.C)
      const sortedItems = routineData.items
        .sort((a, b) => parseInt(a.routineEntry['C']) - parseInt(b.routineEntry['C']))
        .map(item => ({
          ...item,
          itemDetails: item.itemDetails || item
        }));

      setActiveRoutineItems(sortedItems);

      // Log the loaded items structure
      fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `LOAD: Active routine items loaded: ${sortedItems.length} items`,
          level: 'info'
        })
      });

      if (sortedItems.length > 0) {
        fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `LOAD: Sortable IDs: ${sortedItems.map(item => item.routineEntry?.['A'] || item['A']).join(', ')}`,
            level: 'info'
          })
        });
      }
    } catch (error) {
      console.error('Error fetching routine items:', error);
      setError(error.message);
    }
  }, []);

  useEffect(() => {
    fetchActiveRoutineItems();
  }, [fetchActiveRoutineItems]);


  const handleDragEnd = async ({ active, over }) => {
    // Simple sync logging
    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ACTIVE ROUTINE handleDragEnd called: active=${active?.id}, over=${over?.id}`,
        level: 'info'
      })
    });

    if (!active || !over || active.id === over.id) {
      fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'ACTIVE ROUTINE Drag end early return - no valid drag',
          level: 'info'
        })
      });
      return;
    }

    const oldIndex = activeRoutineItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === active.id);
    const newIndex = activeRoutineItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === over.id);

    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ACTIVE ROUTINE Indices: old=${oldIndex}, new=${newIndex}, activeId=${active.id}, overId=${over.id}`,
        level: 'info'
      })
    });


    try {
      // First get the active routine ID
      const response = await fetch('/api/routines/active');
      if (!response.ok) throw new Error('Failed to fetch active routine');
      const data = await response.json();
      const activeId = data.A; // Use Google Sheets format (Column A)


      if (!activeId) {
        throw new Error('No active routine found');
      }

      // Create new array with moved item
      const reordered = arrayMove(activeRoutineItems, oldIndex, newIndex);

      // Update all orders to match new positions, keeping only essential columns
      const withNewOrder = reordered.map((item, index) => ({
        'A': item.routineEntry?.['A'] || item['A'],           // ID (routine entry ID)
        'C': index.toString(),    // Order
      }));


      // Update UI optimistically
      setActiveRoutineItems(reordered);

      // Send update to backend using the active routine ID as sheet name
      const orderUrl = `/api/routines/${activeId}/order`;

      const orderResponse = await fetch(orderUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withNewOrder)
      });

      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        throw new Error(`Failed to update routine order: ${errorText}`);
      }


      // Refresh items to ensure sync
      await fetchActiveRoutineItems();
    } catch (error) {
      console.error('Reorder failed:', error);
      // Revert to original order on error
      await fetchActiveRoutineItems();
    }
  };

  // Debounced function to save routine order to backend
  const saveRoutineOrder = useCallback(async (updates) => {
    try {
      const orderResponse = await fetch('/api/routines/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        throw new Error(`Failed to update routine order: ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to save routine order:', error);
      // Show error to user
      setError('Failed to save routine order. Please refresh the page.');
      // Revert by fetching latest data
      await fetchRoutines();
    }
  }, [fetchRoutines]);

  const handleDragEndInactive = ({ active, over }) => {
    // Log inactive routines drag event
    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `INACTIVE ROUTINES handleDragEnd called: active=${active?.id}, over=${over?.id}`,
        level: 'info'
      })
    });

    if (!active || !over || active.id === over.id) return;

    const oldIndex = inactiveRoutines.findIndex(routine => routine.ID === active.id);
    const newIndex = inactiveRoutines.findIndex(routine => routine.ID === over.id);

    // Create new array with moved item
    const reordered = arrayMove(inactiveRoutines, oldIndex, newIndex);
    
    // Update ALL affected items' order values to match their new positions
    const updates = reordered.map((routine, index) => ({
      'A': routine.ID,
      'D': index.toString()  // New order based on position
    }));
    
    // Update UI optimistically
    setRoutines(prevRoutines => {
      const activeRoutine = prevRoutines.find(r => r.active);
      const updatedInactive = updates.map(update => {
        const original = prevRoutines.find(r => r.ID === update.A);
        return { ...original, order: update.D };
      });
      
      return activeRoutine 
        ? [activeRoutine, ...updatedInactive]
        : updatedInactive;
    });
    
    // Store the pending update
    pendingRoutineOrderRef.current = updates;
    
    // Clear any existing debounce timer
    if (routineOrderDebounceRef.current) {
      clearTimeout(routineOrderDebounceRef.current);
    }
    
    // Set new debounce timer (500ms delay)
    routineOrderDebounceRef.current = setTimeout(() => {
      if (pendingRoutineOrderRef.current) {
        saveRoutineOrder(pendingRoutineOrderRef.current);
        pendingRoutineOrderRef.current = null;
      }
    }, 500);
  };

  useEffect(() => {
    if (!checking) {
      setLoading(true);
      fetchRoutines();
    }
  }, [checking, fetchRoutines]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (routineOrderDebounceRef.current) {
        clearTimeout(routineOrderDebounceRef.current);
        // Save any pending updates before unmounting
        if (pendingRoutineOrderRef.current) {
          saveRoutineOrder(pendingRoutineOrderRef.current);
        }
      }
    };
  }, [saveRoutineOrder]);

  if (checking) {
    return (
      <div className="text-center p-8" role="status" aria-live="polite">
        <h2 className="text-2xl mb-4">Checking authentication...</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center p-8" role="status" aria-live="polite">
        <h2 className="text-2xl mb-4">Loading routines...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl text-red-500 mb-4">Error: {error}</h2>
        <Button onClick={fetchRoutines} className="bg-blue-600 hover:bg-blue-700">
          Retry
        </Button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl mb-4">Please log in to manage routines</h2>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Active Routine Section */}
        <Card className="bg-gray-900 text-gray-100" data-tour="routines-items">
          <CardHeader>
            <CardTitle>Current active routine</CardTitle>
          </CardHeader>
          <CardContent>
            {isAuthenticated ? (
              activeRoutine ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" aria-hidden="true" />
                      {activeRoutine.name}
                    </span>
                    <div className="flex space-x-2" data-tour="edit-routine-icon">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(activeRoutine)}
                        className="text-blue-500 hover:text-blue-400"
                        title="Edit routine"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Edit routine</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeactivateRoutine(activeRoutine.ID)}
                        className="text-gray-400 hover:text-gray-200"
                        title="Deactivate this routine"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Deactivate routine</span>
                      </Button>
                    </div>
                  </div>

                  <p className="text-sm text-gray-500 mt-2">(use drag and drop handles on the left to change order of items)</p>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={(event) => {
                      fetch('/api/debug/log', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          message: `ACTIVE ROUTINE Drag started: ${event.active.id}`,
                          level: 'info'
                        })
                      });
                    }}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={activeRoutineItems.map(item => item.routineEntry?.['A'] || item['A'])}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2 mt-4">
                        {activeRoutineItems.map((item) => (
                          <SortableItem
                            key={item.routineEntry?.['A'] || item['A']}
                            item={item}
                            itemDetails={item.itemDetails}
                            handleOpenChordCharts={handleOpenChordCharts}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                <div className="text-gray-400">No active routine selected</div>
              )
            ) : (
              <div className="text-gray-400">Please log in to manage routines</div>
            )}
          </CardContent>
        </Card>

        {/* Inactive Routines Section */}
        <Card className="bg-gray-900 text-gray-100">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Routines</CardTitle>
            {isAuthenticated && (
              <div data-tour="new-routine-input">
                <Button
                  onClick={() => setShowNewRoutineModal(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-ph-capture-attribute-button="add-new-routine"
                >
                  <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                  New
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isAuthenticated ? (
              <>
                {/* Search field */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                  <Input
                    className="pl-9"
                    placeholder="Search routines..."
                    value={routineSearchQuery}
                    onChange={(e) => setRoutineSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                {/* Routines list */}
                <div className="space-y-2">
                  {routineSearchQuery.trim() ? (
                    // When filtering, show plain list (no drag-and-drop)
                    <div className="space-y-2">
                      {filteredInactiveRoutines.filter(routine => routine.ID != null).map((routine) => (
                        <div
                          key={routine.ID}
                          className="flex items-center justify-between p-3 bg-gray-800 rounded-lg"
                        >
                          <div className="flex items-center">
                            <span>{routine.name}</span>
                          </div>
                          <div className="flex space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleActivateRoutine(routine.ID)}
                              className="text-green-500 hover:text-green-400"
                              title="Make this the active routine"
                              data-ph-capture-attribute-button="activate-routine"
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Activate routine</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(routine)}
                              className="text-blue-500 hover:text-blue-400"
                              title="Edit routine"
                              data-ph-capture-attribute-button="edit-routine"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Edit routine</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-400"
                              onClick={() => handleDeleteClick(routine.ID)}
                              title="Delete this routine"
                              data-ph-capture-attribute-button="delete-routine"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Delete routine</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                      {filteredInactiveRoutines.length === 0 && (
                        <div className="text-gray-500 text-sm text-center py-2">No routines match your search</div>
                      )}
                    </div>
                  ) : (
                    // When not filtering, show sortable list with drag-and-drop
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEndInactive}
                    >
                      <SortableContext
                        items={inactiveRoutines.map(routine => routine.ID).filter(id => id != null)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {inactiveRoutines.filter(routine => routine.ID != null).map((routine) => (
                            <SortableInactiveRoutine
                              key={routine.ID}
                              routine={routine}
                              handleActivateRoutine={handleActivateRoutine}
                              handleEditClick={handleEditClick}
                              handleDeleteClick={handleDeleteClick}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </>
            ) : (
              <div className="text-gray-400">Please log in to manage routines</div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog 
          open={!!routineToDelete} 
          onOpenChange={(isOpen) => {
            if (!isOpen) setRoutineToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete routine</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the "{routineToDelete?.name}" routine? You can't undo this deletion. (Items will remain, but the routine will be gone.)
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteConfirm} className="bg-red-500 hover:bg-red-600">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Create New Routine Modal */}
        <Dialog
          open={showNewRoutineModal}
          onOpenChange={(isOpen) => {
            setShowNewRoutineModal(isOpen);
            if (!isOpen) setNewRoutineName('');
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new routine</DialogTitle>
              <DialogDescription>
                Enter a name for your new routine
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <label htmlFor="new-routine-name-input" className="sr-only">
                New routine name
              </label>
              <Input
                ref={newRoutineInputRef}
                id="new-routine-name-input"
                placeholder="Enter routine name..."
                value={newRoutineName}
                onChange={(e) => setNewRoutineName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && newRoutineName.trim()) {
                    handleCreateRoutine();
                  }
                }}
                autoFocus
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowNewRoutineModal(false);
                  setNewRoutineName('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateRoutine}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!newRoutineName.trim()}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <RoutineEditor
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        routine={editingRoutine}
        onRoutineChange={handleRoutineChange}
        items={items}
      />

      <ChordChartsModal
        isOpen={chordChartsModalOpen}
        onClose={() => setChordChartsModalOpen(false)}
        itemId={selectedItemId}
        itemTitle={selectedItemTitle}
      />

      <TierLimitModal
        isOpen={tierLimitModalOpen}
        onClose={() => setTierLimitModalOpen(false)}
        limitType={tierLimitData.limitType}
        currentTier={tierLimitData.currentTier}
        currentCount={tierLimitData.currentCount}
        limitAmount={tierLimitData.limitAmount}
      />
    </>
  );
};

export default RoutinesPage;