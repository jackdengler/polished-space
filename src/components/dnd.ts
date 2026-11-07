import { PointerSensor, type Modifier } from '@dnd-kit/core';
import type { PointerEvent } from 'react';

/** Don't start a drag from text fields or anything marked data-no-dnd (clicks on buttons still work: drags need 6px of movement). */
export class SmartPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent }: PointerEvent) =>
      nativeEvent.isPrimary && nativeEvent.button === 0 &&
      !(nativeEvent.target as Element).closest('input, textarea, select, [contenteditable="true"], [data-no-dnd]'),
  }];
}

export const sensorOptions = { activationConstraint: { distance: 6 } };

export const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
export const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });
