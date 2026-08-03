// app/static/js/components/AddToRoutineModal.jsx
// Offered right after an item is created: a freshly made item that never gets
// added to a routine never shows up on the Practice page, which was leaving new
// users with items they couldn't find again.
import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useIsMobile } from '@hooks/useIsMobile';

// Above this many routines the list can't fit a phone viewport, so it gets a
// search field. Below it, search would just be another thing to skip past.
const SEARCH_THRESHOLD = 6;

const AddToRoutineModal = ({ open, onOpenChange, item, onAdded }) => {
  const isMobile = useIsMobile();
  const contentRef = useRef(null);
  const [routines, setRoutines] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setError(null);
      setSavingId(null);
      return;
    }

    // Fires here rather than where the modal is queued, so the event can't
    // claim a prompt the user never actually saw
    window.posthog?.capture('add_to_routine_prompt_shown', { item_id: item?.['B'] });

    setLoading(true);
    fetch('/api/routines')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load routines');
        return res.json();
      })
      .then(data => {
        setRoutines(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const itemId = item?.['B'];
  const itemName = item?.['C'] || 'this item';

  const q = query.trim().toLowerCase();
  const filtered = q
    ? routines.filter(r => (r.name || '').toLowerCase().includes(q))
    : routines;

  const handleAdd = async (routine) => {
    if (savingId != null || itemId == null) return;
    setSavingId(routine.ID);
    setError(null);
    try {
      const response = await fetch(`/api/routines/${routine.ID}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      if (!response.ok) throw new Error('Failed to add item to routine');

      window.posthog?.capture('item_added_to_routine', {
        surface: 'post_create_modal',
        routine_id: routine.ID,
        routine_is_active: !!routine.active,
        item_id: itemId,
      });

      onAdded?.(routine);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-w-md bg-gray-800"
        modalName="Add item to routine"
        onOpenAutoFocus={(e) => {
          // Mobile: don't let Radix focus the search field — the keyboard would
          // cover the routine list this modal exists to show.
          if (!isMobile) return;
          e.preventDefault();
          requestAnimationFrame(() => contentRef.current?.focus());
        }}
      >
        <DialogHeader>
          <DialogTitle>Add this item to a routine</DialogTitle>
          <DialogDescription>
            "{itemName}" is saved. Pick a routine to practice it in, or add it later.
          </DialogDescription>
          {error && (
            <div className="mt-2 text-sm text-red-500" role="alert">
              {error}
            </div>
          )}
        </DialogHeader>

        {routines.length > SEARCH_THRESHOLD && (
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Search routines..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search routines"
              autoComplete="off"
            />
          </div>
        )}

        <div className="space-y-2 max-h-[45vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-gray-400" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading routines...
            </div>
          ) : filtered.length === 0 ? (
            // Suppressed on error: "no routines yet" alongside a failure banner
            // reads as data loss rather than a failed request
            !error && (
              <div className="text-center text-sm text-gray-500 py-6">
                {q ? 'No routines match your search' : 'No routines yet — create one on the Routines page'}
              </div>
            )
          ) : (
            filtered.map(routine => (
              <button
                key={routine.ID}
                type="button"
                onClick={() => handleAdd(routine)}
                disabled={savingId != null}
                className="flex items-center justify-between w-full p-3 bg-gray-900 rounded-lg text-left hover:bg-gray-700 transition-colors disabled:opacity-60"
                data-ph-capture-attribute-button="add-to-routine-choice"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{routine.name}</span>
                  {routine.active && (
                    <span className="text-xs font-semibold text-orange-400 shrink-0">Active</span>
                  )}
                </span>
                {/* Plus, not a checkmark — a tick reads as "already in this
                    routine" rather than "tap to add" */}
                {savingId === routine.ID ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4 text-blue-400 shrink-0" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              window.posthog?.capture('add_to_routine_skipped', { item_id: itemId });
              onOpenChange(false);
            }}
            className="text-gray-300 hover:text-white"
            data-ph-capture-attribute-button="add-to-routine-skip"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddToRoutineModal;
