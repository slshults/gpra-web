import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

// Simple markdown renderer for basic formatting
const renderMarkdown = (text) => {
  if (!text) return '';

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code: `code`
  html = html.replace(/`(.+?)`/g, '<code class="bg-gray-700 px-1 rounded">$1</code>');

  // Links: [text](url)
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-400 underline" target="_blank" rel="noopener noreferrer">$1</a>');

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
};

export const NoteEditor = ({ open, onOpenChange, itemId, currentNote = '', onNoteSave }) => {
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const initialNoteRef = useRef('');

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setNoteText(currentNote);
      initialNoteRef.current = currentNote;
      setError(null);
      setShowConfirmModal(false);
      setShowPreview(false);
    }
  }, [open, currentNote]);

  const hasUnsavedChanges = () => {
    return noteText !== initialNoteRef.current && noteText.trim() !== '';
  };

  const handleClose = () => {
    if (hasUnsavedChanges()) {
      setShowConfirmModal(true);
    } else {
      onOpenChange(false);
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
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
      initialNoteRef.current = noteText; // Update initial to prevent confirm on future close
      onNoteSave?.(noteText);
      setShowConfirmModal(false);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
      console.error('Save error:', err);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(newOpen) => {
        if (!newOpen) {
          handleClose();
        } else {
          onOpenChange(true);
        }
      }}>
        <DialogContent className="max-w-2xl bg-gray-800">
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
            <DialogDescription>
              Add or edit your practice notes (markdown supported)
            </DialogDescription>
            {error && (
              <div className="mt-2 text-sm text-red-500">
                {error}
              </div>
            )}
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Toggle between edit and preview */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!showPreview ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowPreview(false)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant={showPreview ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowPreview(true)}
              >
                Preview
              </Button>
            </div>

            {showPreview ? (
              <div
                className="h-48 bg-gray-900 text-white p-3 rounded-md overflow-auto"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(noteText) }}
              />
            ) : (
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Enter your notes... (markdown supported)"
                className="h-48 bg-gray-900 text-white"
                autoComplete="off"
              />
            )}

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" variant="outline">
                Save note
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-md bg-gray-800">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              Are you sure you want to lose what you typed?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end space-x-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
            >
              Keep editing
            </Button>
            <Button
              variant="outline"
              className="text-red-400 hover:text-red-300"
              onClick={() => {
                setShowConfirmModal(false);
                onOpenChange(false);
              }}
            >
              Lose it
            </Button>
            <Button
              variant="default"
              onClick={handleSubmit}
            >
              Save it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default NoteEditor;
