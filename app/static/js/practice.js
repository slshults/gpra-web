// Add this at the very top of the file
// Development-only console logging (checks Flask debug mode via window.GPRA_DEBUG)
function debugLog(prefix, ...args) {
  if (typeof window !== 'undefined' && window.GPRA_DEBUG === true) {
    console.log(`[${prefix}]`, ...args);
  }
}

(() => {
    debugLog('Practice', 'Practice.js loaded!');
    // Uncomment the next line temporarily for testing
    // alert('Practice.js loaded!');
})();

// Remove the alert since we're debugging
debugLog('Practice', 'practice.js loaded');

// Update saveNote function to match our API structure
async function saveNote(itemId, noteText) {
    debugLog('Notes', 'Attempting to save note:', { itemId, noteText });
    try {
        const response = await fetch(`/api/items/${itemId}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                notes: noteText // Preserve original case
            }),
        });
        
        if (!response.ok) {
            throw new Error(`Failed to save note: ${response.status}`);
        }
        const result = await response.json();
        debugLog('Notes', 'Note saved successfully:', result);
    } catch (error) {
        console.error('Error saving note:', error);
    }
}

// Update the note input handler to save notes
function handleNoteInput(event, itemId) {
    const noteText = event.target.value;
    // Debounce the save operation to avoid too many requests
    clearTimeout(window.notesSaveTimeout);
    window.notesSaveTimeout = setTimeout(() => {
        saveNote(itemId, noteText);
    }, 1000); // Save after 1 second of no typing
}

// Update the loadItem function to include notes
function loadItem(item) {
    debugLog('Practice', 'loadItem called with:', item);
    if (!item) {
        debugLog('Practice', 'Warning: loadItem called with no item');
        return;
    }
    if (!item['A']) {  // Column A is ID
        debugLog('Practice', 'Warning: item has no ID:', item);
        return;
    }
    
    debugLog('Practice', 'Loading item:', item);
    
    // Add notes handling
    const notesTextarea = document.getElementById(`item-notes-${item['A']}`);  // Column A is ID
    const addNoteBtn = document.getElementById(`add-note-btn-${item['A']}`);  // Column A is ID
    
    if (notesTextarea) {
        debugLog('Practice', 'Found textarea for item:', item['A']);  // Column A is ID
        
        // Fetch current notes from the Items sheet
        fetch(`/api/items/${item['A']}/notes`)  // Column A is ID
            .then(response => response.json())
            .then(data => {
                notesTextarea.value = data.notes || '';
                
                // Remove any existing event listeners
                notesTextarea.removeEventListener('input', handleNoteInput);
                
                // Add the event listener
                notesTextarea.addEventListener('input', (event) => {
                    debugLog('Notes', 'Note input event triggered');
                    handleNoteInput(event, item['A']);  // Column A is ID
                });
            })
            .catch(error => {
                console.error('Error loading notes:', error);
            });
    }

    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => {
            debugLog('Notes', 'Add note button clicked');
            addNote(item['A']);  // Column A is ID
        });
    }
}

// Add this function to handle adding a new note
function addNote(itemId) {
    const textarea = document.getElementById(`item-notes-${itemId}`);
    if (textarea) {
        // Set focus to the textarea
        textarea.focus();
        
        // If there's existing text, add a newline before the new note
        if (textarea.value && !textarea.value.endsWith('\n')) {
            textarea.value += '\n';
        }
        
        // Add timestamp for the new note
        const now = new Date();
        const timestamp = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
        textarea.value += `${timestamp}\n`;
        
        // Trigger the save
        handleNoteInput({ target: textarea }, itemId);
    }
}

// Add this helper function to initialize notes for an item
function initializeNotes(itemId) {
    debugLog('Notes', 'Initializing notes for item:', itemId);
    const item = {
        'A': itemId,  // Column A is ID
        'D': document.getElementById(`item-notes-${itemId}`)?.value || ''  // Column D is Notes
    };
    loadItem(item);
}

// Call this when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    debugLog('Practice', 'DOM loaded, looking for items to initialize');
    // Find any items that need notes initialized
    const notesSections = document.querySelectorAll('.notes-section');
    notesSections.forEach(section => {
        const textarea = section.querySelector('textarea');
        if (textarea) {
            const itemId = textarea.id.replace('item-notes-', '');
            debugLog('Practice', 'Found notes section for item:', itemId);
            initializeNotes(itemId);
        }
    });
}); 