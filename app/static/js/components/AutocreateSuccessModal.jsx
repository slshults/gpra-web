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

const AutocreateSuccessModal = ({ isOpen, onClose, autocreateData }) => {
  if (!isOpen || !autocreateData) return null;

  const {
    itemName,
    chordCount,
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
    return "Chord Charts Created!";
  };

  const getDescription = () => {
    return (
      <div className="space-y-1">
        <p className="font-medium">Success! Or close to it!</p>
        <p>We did the best we could. You'll likely need to make a few corrections.</p>
        <p>Click the pencil icon on a chord chart to fix it.</p>
        <p>Be sure to click the <code className="px-1 py-0.5 bg-gray-700 text-gray-300 rounded text-sm">"Update chord chart"</code> button after edits</p>
      </div>
    );
  };

  const getDetails = () => {
    const details = [];

    if (contentType) {
      const typeLabels = {
        'chord_charts': 'Chord charts',
        'chord_names': 'Lyrics with chord names',
        'tablature': 'Guitar tablature',
        'mixed': 'Mixed content types',
        'auto-detected': isComplexVisionAnalysis ? 'Chord charts' : 'Mixed content'
      };
      details.push(typeLabels[contentType] || contentType);
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

    return details;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="text-left space-y-1">
            {getDescription()}

            <div className="bg-gray-800 px-2 py-1 rounded-lg">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
                <FileText className="h-4 w-4" />
                <span>Processing Details</span>
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
          </DialogDescription>
        </DialogHeader>
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