// app/static/js/components/RoutineEditor.jsx
import React, { useState, useEffect } from 'react';
import { useRoutineEditor } from '@hooks/useRoutineEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Search, Plus, GripVertical, X } from 'lucide-react';
import { trackRoutineOperation } from '../utils/analytics';
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

// Available item in the search list
const AvailableItem = React.memo(({ item, onAdd }) => (
  <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
    <span className="text-lg">{item['C']}</span>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onAdd(item)}
      className="text-blue-500 hover:text-blue-400"
    >
      <Plus className="h-4 w-4" />
    </Button>
  </div>
));

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
        <div {...attributes} {...listeners}>
          <GripVertical className="h-5 w-5 text-gray-500 mr-4 cursor-move" />
        </div>
        <span className="text-lg">{item.itemDetails?.['C'] || 'Loading...'}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(item.routineEntry?.['A'] || item['A'])}
        className="text-red-500 hover:text-red-400"
      >
        <X className="h-4 w-4" />
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
  const [error, setError] = useState(null);

  // Clear error when modal opens/closes
  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  // For debugging
  useEffect(() => {
  }, [routine]);

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

  const handleDragEnd = async ({ active, over }) => {

    if (active.id !== over?.id) {

      const oldIndex = selectedItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === active.id);
      const newIndex = selectedItems.findIndex(item => (item.routineEntry?.['A'] || item['A']) === over.id);


      // Create new array with items in new positions
      const reordered = arrayMove(selectedItems, oldIndex, newIndex);

      // Update all orders to match new positions
      const withNewOrder = reordered.map((item, index) => ({
        'A': item.routineEntry?.['A'] || item['A'],  // ID
        'C': index.toString()         // New order
      }));


      // Update local state first for immediate UI feedback
      setSelectedItems(reordered);

      if (routine?.id) {
        try {
          await updateRoutineOrder(routine.id, withNewOrder);

          // Notify parent component that routine was changed
          if (onRoutineChange) {
            onRoutineChange();
          }
        } catch (error) {
          console.error('Failed to update routine order:', error);
          // Revert to previous state on error
          setSelectedItems(selectedItems);
        }
      } else {
      }
    } else {
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
            {routine ? `Edit routine: ${routine.name}` : 'Create new routine'}
          </DialogTitle>
          <DialogDescription>
            Add or remove items and arrange them in your preferred order
          </DialogDescription>
          {error && (
            <div className="mt-2 text-sm text-red-500" role="alert">
              {error}
            </div>
          )}
        </DialogHeader>

        <div className="flex gap-8 h-[60vh]">
          {/* Selected Items */}
          <Card className="w-1/2 bg-gray-900">
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={selectedItems.map(item => item.routineEntry?.['A'] || item['A']).filter(id => id != null)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {selectedItems.filter(item => (item.routineEntry?.['A'] || item['A']) != null).map((item) => (
                      <SortableRoutineItem
                        key={item.routineEntry?.['A'] || item['A']}
                        item={item}
                        onRemove={handleRemoveItem}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>

          {/* Available Items */}
          <Card className="w-1/2 bg-gray-900">
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
            <CardContent className="space-y-4 overflow-y-auto h-[calc(100%-100px)]">
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

      </DialogContent>
    </Dialog>
  );
};

export default RoutineEditor;