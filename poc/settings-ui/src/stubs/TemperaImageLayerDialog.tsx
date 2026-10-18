/* 凝彩's image-layer browser (a modal that lists local IndexedDB images). The injected settings
 * page cannot add image layers, so the dialog is an inert placeholder. */
import React from 'react';

export type TemperaPoolBusyAction = 'idle' | 'adding' | 'exporting' | 'importing';

export const isTemperaPoolWriteLocked = (busy: TemperaPoolBusyAction): boolean => (
    busy === 'adding' || busy === 'exporting' || busy === 'importing'
);

export interface TemperaImageLayerDialogProps {
    open?: boolean;
    onClose?: () => void;
}

const TemperaImageLayerDialog: React.FC<TemperaImageLayerDialogProps> = () => null;

export default TemperaImageLayerDialog;
