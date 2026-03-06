// app/static/js/components/RoutineEditor.jsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRoutineEditor } from '@hooks/useRoutineEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Search, Plus, GripVertical, X } from 'lucide-react';
import { trackRoutineOperation } from '../utils/analytics';
import { debugLog } from '@utils/logging';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Available item in the search list (draggable for cross-column DnD)
const AvailableItem = React.memo(({ item, onAdd }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `available-${item['B']}`,
    data: { item, type: 'available' },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between p-4 bg-gray-800 rounded-lg ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center">
        <div {...attributes} {...listeners}>
          <GripVertical className="h-5 w-5 text-gray-500 mr-4 cursor-grab" aria-hidden="true" />
        </div>
        <span className="text-lg">{item['C']}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAdd(item)}
        className="text-blue-500 hover:text-blue-400"
        aria-label="Add item to routine"
        data-ph-capture-attribute-button="routine-add-item"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
});

// Droppable zone for the selected items column (enables drops on empty list)
const SelectedItemsDropZone = ({ children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: 'selected-items-drop-zone' });
  return (
    <div ref={setNodeRef} className={`space-y-4 min-h-[60px] ${isOver ? 'ring-2 ring-blue-500 ring-opacity-50 rounded-lg' : ''}`}>
      {children}
    </div>
  );
};

// Sortable item component for selected items
const SortableRoutineItem = React.memo(({ item, onRemove }) => {
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
      className={`flex items-center justify-between p-4 ${
        isDragging ? 'bg-gray-700' : 'bg-gray-800'
      } rounded-lg`}
    >
      <div className="flex items-center">
        <div {...attributes} {...listeners} aria-label="Drag to reorder item in routine" data-ph-capture-attribute-drag="routine-editor-drag-handle">
          <GripVertical className="h-5 w-5 text-gray-500 mr-4 cursor-move" aria-hidden="true" />
        </div>
        <span className="text-lg">{item.itemDetails?.['C'] || 'Loading...'}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(item.routineEntry?.['A'] || item['A'])}
        className="text-red-500 hover:text-red-400"
        aria-label="Remove item from routine"
        data-ph-capture-attribute-button="routine-remove-item"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
});

export const RoutineEditor = ({ open, onOpenChange, routine = null, onRoutineChange, items = [] }) => {
  const {
    availableItems,
    selectedItems,
    setSelectedItems,
    searchQuery,
    setSearchQuery,
    loading,
    error: hookError,
    addToRoutine,
    removeFromRoutine,
    updateRoutineOrder,
  } = useRoutineEditor(routine?.id, routine?.details, items);

  const [newRoutineName, setNewRoutineName] = useState(routine?.name || '');
  const [routineName, setRoutineName] = useState(routine?.name || '');
  const [error, setError] = useState(null);
  const [draggedAvailableItem, setDraggedAvailableItem] = useState(null);

  const handleRoutineNameBlur = async () => {
    if (!routine?.id || routineName.trim() === routine.name) return;
    if (!routineName.trim()) {
      setRoutineName(routine.name);
      return;
    }
    try {
      const response = await fetch(`/api/routines/${routine.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ B: routineName.trim() }),
      });
      if (!response.ok) throw new Error('Failed to update routine name');
      onRoutineChange?.();
    } catch (err) {
      setError(err.message);
      setRoutineName(routine.name);
    }
  };

  // Sync routineName when a different routine is opened
  useEffect(() => {
    setRoutineName(routine?.name || '');
  }, [routine?.id]);

  // Clear error when modal opens/closes
  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  // Custom collision detection: prefer individual items over the container drop zone
  const preferItemsCollision = (args) => {
    const collisions = closestCenter(args);
    const itemCollisions = collisions.filter(c => c.id !== 'selected-items-drop-zone');
    return itemCollisions.length > 0 ? itemCollisions : collisions;
  };

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

  const handleDragStart = ({ active }) => {
    if (String(active.id).startsWith('available-')) {
      setDraggedAvailableItem(active.data.current.item);
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    setDraggedAvailableItem(null);

    if (!over) return;

    const activeId = String(active.id);

    // Cross-column: dragging from available to selected
    if (activeId.startsWith('available-')) {
      const draggedItem = active.data.current.item;
      if (!routine?.id) return;

      // Determine insertion index from the drop target
      const overId = String(over.id);
      let insertIndex = selectedItems.length; // default: append to end

      if (overId.startsWith('available-')) {
        // Dropped back on available column — do nothing
        return;
      }

      // Dropped on a specific selected item — insert at that position
      if (overId !== 'selected-items-drop-zone') {
        const overIndex = selectedItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === over.id);
        if (overIndex !== -1) {
          insertIndex = overIndex;
        }
      }
      // Otherwise dropped on the empty drop zone — append to end (insertIndex already set)

      try {
        setError(null);

        // Calculate the actual order value for the backend
        let orderValue = null;
        if (insertIndex < selectedItems.length) {
          orderValue = parseInt(selectedItems[insertIndex].routineEntry['C']);
        }
        // If orderValue is null (dropped at end or on empty zone), backend appends as before

        debugLog('DnD', 'Cross-column drop:', { overId: over.id, insertIndex, orderValue, selectedCount: selectedItems.length, draggedItem: draggedItem['C'] });

        const success = await addToRoutine(routine.id, draggedItem['B'], orderValue);
        if (!success) {
          throw new Error('Failed to add item to routine');
        }

        trackRoutineOperation('item_added', routine.name, draggedItem['C'], {
          routine_id: routine.id,
          item_id: draggedItem['B'],
          added_via: 'drag_and_drop'
        });

        onRoutineChange?.();
      } catch (err) {
        setError(err.message);
        console.error('Error adding item via drag:', err);
      }

      return;
    }

    // Same-column reorder (existing logic)
    if (active.id === over?.id) return;

    const oldIndex = selectedItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === active.id);
    const newIndex = selectedItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === over.id);

    const reordered = arrayMove(selectedItems, oldIndex, newIndex);

    const withNewOrder = reordered.map((item, index) => ({
      'A': item.routineEntry?.['A'] || item['A'],
      'C': index.toString()
    }));

    // Update local state first for immediate UI feedback
    setSelectedItems(reordered);

    if (routine?.id) {
      try {
        await updateRoutineOrder(routine.id, withNewOrder);
        onRoutineChange?.();
      } catch (error) {
        console.error('Failed to update routine order:', error);
        setSelectedItems(selectedItems);
      }
    }
  };

  const handleAddItem = async (item) => {
    try {
      setError(null);
      if (!routine?.id) {
        // For new routines, just update local state
        setSelectedItems(prev => [...prev, {
          routineEntry: {
            'A': item['A'],  // ID
            'B': item['B'],  // Item ID
            'C': prev.length.toString(),  // Order
            'D': 'FALSE',  // Completed
          },
          itemDetails: item  // Include all item properties
        }]);
      } else {
        // For existing routines, call API through the hook
        const success = await addToRoutine(routine.id, item['B']);  // Use Item ID from column B
        if (!success) {
          throw new Error('Failed to add item to routine');
        }

        // Track item added to routine
        trackRoutineOperation('item_added', routine.name, item['C'], {
          routine_id: routine.id,
          item_id: item['B']
        });

        // Notify parent of change
        onRoutineChange?.();
      }
    } catch (err) {
      setError(err.message);
      console.error('Error adding item:', err);
    }
  };

  const handleRemoveItem = async (routineEntryId) => {
    try {
      setError(null);
      if (!routine?.id) {
        // For new routines, just update local state
        setSelectedItems(prev => prev.filter(item => item.routineEntry['A'] !== routineEntryId));
      } else {
        // Find the item being removed for tracking
        const itemBeingRemoved = selectedItems.find(
          item => (item.routineEntry?.['A'] || item['A']) === routineEntryId
        );

        // For existing routines, call API through the hook with routine entry ID
        const success = await removeFromRoutine(routine.id, routineEntryId);
        if (!success) {
          throw new Error('Failed to remove item from routine');
        }

        // Track item removed from routine
        if (itemBeingRemoved) {
          trackRoutineOperation('item_removed', routine.name, itemBeingRemoved.itemDetails?.['C'], {
            routine_id: routine.id,
            item_id: itemBeingRemoved.itemDetails?.['B']
          });
        }

        // Notify parent of change
        onRoutineChange?.();
      }
    } catch (err) {
      setError(err.message);
      console.error('Error removing item:', err);
    }
  };

  if (loading) return <div className="text-2xl text-center p-8" role="status" aria-live="polite">Loading...</div>;
  if (hookError) return <div className="text-2xl text-red-500 text-center p-8" role="alert">{hookError}</div>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            {routine ? (
              <Input
                value={routineName}
                onChange={(e) => setRoutineName(e.target.value)}
                onBlur={handleRoutineNameBlur}
                className="text-lg font-semibold"
                autoComplete="off"
                aria-label="Routine name"
              />
            ) : 'Create new routine'}
          </DialogTitle>
          <DialogDescription>
            Add or remove items, drag and drop to rearrange
          </DialogDescription>
          {error && (
            <div className="mt-2 text-sm text-red-500" role="alert">
              {error}
            </div>
          )}
        </DialogHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={preferItemsCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggedAvailableItem(null)}
        >
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 h-[70vh] sm:h-[60vh] overflow-y-auto sm:overflow-visible">
            {/* Selected Items */}
            <Card className="w-full sm:w-1/2 min-h-[35vh] sm:min-h-0 bg-gray-900">
              <CardHeader>
                <CardTitle>Selected items</CardTitle>
                {!routine?.name && (
                  <Input
                    placeholder="Enter routine name..."
                    value={newRoutineName}
                    onChange={(e) => setNewRoutineName(e.target.value)}
                    className="mt-2"
                    autoComplete="off"
                  />
                )}
              </CardHeader>
              <CardContent className="space-y-4 overflow-y-auto h-[calc(100%-100px)]">
                <SortableContext
                  items={selectedItems.map(item => item.routineEntry?.['A'] || item['A']).filter(id => id != null)}
                  strategy={verticalListSortingStrategy}
                >
                  <SelectedItemsDropZone>
                    {selectedItems.filter(item => (item.routineEntry?.['A'] || item['A']) != null).map((item) => (
                      <SortableRoutineItem
                        key={item.routineEntry?.['A'] || item['A']}
                        item={item}
                        onRemove={handleRemoveItem}
                      />
                    ))}
                  </SelectedItemsDropZone>
                </SortableContext>
              </CardContent>
            </Card>

            {/* Available Items */}
            <Card className="w-full sm:w-1/2 min-h-[35vh] sm:min-h-0 bg-gray-900">
              <CardHeader>
                <CardTitle>Available items</CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" />
                  <Input
                    className="pl-9"
                    placeholder="Search items..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 h-[calc(100%-100px)] overflow-y-auto">
                {availableItems.map(item => (
                  <AvailableItem
                    key={item['A']}
                    item={item}
                    onAdd={handleAddItem}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          {createPortal(
            <DragOverlay dropAnimation={null}>
              {draggedAvailableItem ? (
                <div className="flex items-center p-4 bg-gray-800 rounded-lg shadow-lg border border-blue-500 opacity-90">
                  <GripVertical className="h-5 w-5 text-gray-500 mr-4" aria-hidden="true" />
                  <span className="text-lg">{draggedAvailableItem['C']}</span>
                </div>
              ) : null}
            </DragOverlay>,
            document.body
          )}
        </DndContext>

      </DialogContent>
    </Dialog>
  );
};

export default RoutineEditor;