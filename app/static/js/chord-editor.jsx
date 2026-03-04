import '../css/input.css'
import React from 'react';
import ReactDOM from 'react-dom/client';
import PublicChordEditor from '@components/PublicChordEditor';

const root = document.getElementById('chord-editor-root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <PublicChordEditor />
    </React.StrictMode>
  );
}
