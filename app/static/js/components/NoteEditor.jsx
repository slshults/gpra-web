import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export const NoteEditor = ({ open, onOpenChange, itemId, currentNote = '', onNoteSave }) => {
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setNoteText(currentNote);
      setError(null);
    }
  }, [open, currentNote]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`/api/items/${itemId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes: noteText })
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      const result = await response.json();
      onNoteSave?.(noteText);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
      console.error('Save error:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-gray-800">
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
          <DialogDescription>
            Add or edit your practice notes
          </DialogDescription>
          {error && (
            <div className="mt-2 text-sm text-red-500">
              {error}
            </div>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Enter your notes..."
            className="h-48 bg-gray-900 text-white"
            autoComplete="off"
          />

          <div className="flex justify-end space-x-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="outline">
              Save note
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NoteEditor; 