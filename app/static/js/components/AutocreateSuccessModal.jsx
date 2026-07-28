import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { CheckCircle2, FileText, Music, Zap } from 'lucide-react';
import { useIsMobile } from '@hooks/useIsMobile';

const AutocreateSuccessModal = ({ isOpen, onClose, autocreateData }) => {
  const isMobile = useIsMobile();

  if (!isOpen || !autocreateData) return null;

  const {
    itemName,
    chordCount,
    chordLoadFailures = 0,
    contentType,
    uploadedFileNames,
    isVisionAnalysis = false
  } = autocreateData;

  // Determine if this was a complex visual analysis (more exciting)
  const isComplexVisionAnalysis = isVisionAnalysis || contentType === 'chord_charts' || contentType === 'auto-detected';

  const getIcon = () => {
    if (isComplexVisionAnalysis) {
      return <Zap className="h-6 w-6 text-yellow-500" />;
    }
    return <CheckCircle2 className="h-6 w-6 text-green-500" />;
  };

  const getTitle = () => {
    if (isComplexVisionAnalysis) {
      return "🎸 Vision Analysis Complete!";
    }
    return "Chord charts created";
  };

  const getDescription = () => {
    return (
      <div className="space-y-1">
        <p className="font-medium">Success! Or close to it!</p>
        <p>We did the best we could. You'll likely need to make a few corrections.</p>
        {/* Mobile has no pencil icon on the tile — you tap a chart to enlarge it
            and pick Edit from there */}
        {isMobile ? (
          <p>Tap a chord chart, then "Edit", to fix it.</p>
        ) : (
          <p>Click the pencil icon on a chord chart to fix it.</p>
        )}
        <p>Be sure to {isMobile ? 'tap' : 'click'} the <code className="px-1 py-0.5 bg-gray-700 text-gray-300 rounded text-sm">"Update chord chart"</code> button after edits</p>
      </div>
    );
  };

  const getDetails = () => {
    const details = [];

    // Map content types to human-readable labels
    const typeLabels = {
      'chord_charts': 'Chord charts',
      'chord_names': 'Lyrics with chord names',
      'tablature': 'Guitar tablature',
      'mixed': 'Mixed content types',
      'auto-detected': isComplexVisionAnalysis ? 'Chord charts' : 'Mixed content',
      'youtube_transcript': 'YouTube transcript'
    };

    // Check if uploadedFileNames is a source method (not actual file names)
    const sourceMethodLabels = ['YouTube transcript', 'Manual entry'];
    const isSourceMethod = sourceMethodLabels.includes(uploadedFileNames);

    // For source methods (YouTube/Manual), show only the source, not the content type
    // since the content type is redundant (e.g., youtube_transcript + "YouTube transcript")
    if (isSourceMethod) {
      details.push(uploadedFileNames);
    } else {
      // For file uploads, show content type and file names
      if (contentType && typeLabels[contentType]) {
        details.push(typeLabels[contentType]);
      }

      if (uploadedFileNames) {
        const fileList = uploadedFileNames.split(', ').slice(0, 3); // Show max 3 files
        const remainingCount = uploadedFileNames.split(', ').length - fileList.length;
        let fileText = fileList.join(', ');
        if (remainingCount > 0) {
          fileText += ` and ${remainingCount} more`;
        }
        details.push(fileText);
      }
    }

    return details;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" modalName="Autocreate success">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Chord chart autocreate finished. {chordLoadFailures > 0 ? `${chordLoadFailures} chord${chordLoadFailures === 1 ? '' : 's'} failed due to API traffic; please retry.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="text-left space-y-2 -mt-2">
          {getDescription()}

          {chordLoadFailures > 0 && (
            <div className="bg-amber-900/40 border border-amber-700/60 px-3 py-2 rounded-lg text-amber-200 text-sm">
              {chordLoadFailures} chord{chordLoadFailures === 1 ? '' : 's'} couldn't get here because there was too much traffic on the way to the venue. Please retry.
            </div>
          )}

          <div className="bg-gray-800 px-2 py-1 rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
              <FileText className="h-4 w-4" />
              <span>Details</span>
            </div>
            <ul className="text-sm text-gray-400">
              {getDetails().map((detail, index) => (
                <li key={index} className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 -mt-2">
          <Button onClick={onClose} variant="outline" className="min-w-20">
            Show me
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutocreateSuccessModal;