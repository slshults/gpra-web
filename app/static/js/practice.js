// Add this at the very top of the file
(() => {
    console.log('🎸 Practice.js loaded!');
    // Uncomment the next line temporarily for testing
    // alert('Practice.js loaded!');
})();

// Remove the alert since we're debugging
console.log('practice.js loaded');

// Update saveNote function to match our API structure
async function saveNote(itemId, noteText) {
    console.log('Attempting to save note:', { itemId, noteText });
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
        console.log('Note saved successfully:', result);
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
    console.log('loadItem called with:', item);
    if (!item) {
        console.log('Warning: loadItem called with no item');
        return;
    }
    if (!item['A']) {  // Column A is ID
        console.log('Warning: item has no ID:', item);
        return;
    }
    
    console.log('Loading item:', item);
    
    // Add notes handling
    const notesTextarea = document.getElementById(`item-notes-${item['A']}`);  // Column A is ID
    const addNoteBtn = document.getElementById(`add-note-btn-${item['A']}`);  // Column A is ID
    
    if (notesTextarea) {
        console.log('Found textarea for item:', item['A']);  // Column A is ID
        
        // Fetch current notes from the Items sheet
        fetch(`/api/items/${item['A']}/notes`)  // Column A is ID
            .then(response => response.json())
            .then(data => {
                notesTextarea.value = data.notes || '';
                
                // Remove any existing event listeners
                notesTextarea.removeEventListener('input', handleNoteInput);
                
                // Add the event listener
                notesTextarea.addEventListener('input', (event) => {
                    console.log('Note input event triggered');
                    handleNoteInput(event, item['A']);  // Column A is ID
                });
            })
            .catch(error => {
                console.error('Error loading notes:', error);
            });
    }

    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => {
            console.log('Add note button clicked');
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
    console.log('Initializing notes for item:', itemId);
    const item = {
        'A': itemId,  // Column A is ID
        'D': document.getElementById(`item-notes-${itemId}`)?.value || ''  // Column D is Notes
    };
    loadItem(item);
}

// Call this when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, looking for items to initialize');
    // Find any items that need notes initialized
    const notesSections = document.querySelectorAll('.notes-section');
    notesSections.forEach(section => {
        const textarea = section.querySelector('textarea');
        if (textarea) {
            const itemId = textarea.id.replace('item-notes-', '');
            console.log('Found notes section for item:', itemId);
            initializeNotes(itemId);
        }
    });
}); 