import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@ui/dialog';
import { Button } from '@ui/button';

const RowActionTipModal = ({ open, onOpenChange, modalName, title, description, tips = [] }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent modalName={modalName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-gray-200">
          {tips.map((tip, idx) => (
            <li key={idx} className="flex items-center gap-2">
              {tip.icon && (
                <span className="inline-flex items-center justify-center flex-shrink-0">
                  {tip.icon}
                </span>
              )}
              <span>{tip.label}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RowActionTipModal;
