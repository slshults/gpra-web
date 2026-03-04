import { useState } from 'react';
import { ChordChartEditor } from '@components/ChordChartEditor';

const PublicChordEditor = () => {
  const [editorKey, setEditorKey] = useState(0);

  const handleClear = () => {
    setEditorKey(prev => prev + 1);
  };

  return (
    <ChordChartEditor
      key={editorKey}
      itemId={null}
      onSave={handleClear}
      saveButtonLabel="Clear and start over"
      showLineBreak={false}
    />
  );
};

export default PublicChordEditor;
