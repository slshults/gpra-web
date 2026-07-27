// Shared YouTube link validation for the autocreate flow.
//
// Both PracticePage and ChordChartsModal validate a pasted link before asking
// the backend for a transcript, and the mobile creator has to run the same check
// earlier still — it clears the item's existing charts before starting a run, so
// a link it was only going to reject must not get that far.

// Strip the characters the URL inputs also strip on change, so a link that would
// be accepted after sanitising isn't rejected here.
export const sanitizeYouTubeUrl = (url) => (url || '').trim().replace(/[<>"']/g, '');

const YOUTUBE_URL = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)(\?.*|&.*)?$/;

export const isValidYouTubeUrl = (url) => YOUTUBE_URL.test(sanitizeYouTubeUrl(url));

export const INVALID_YOUTUBE_URL_MESSAGE =
  'Please enter a valid YouTube URL (e.g., https://youtube.com/watch?v=...)';
