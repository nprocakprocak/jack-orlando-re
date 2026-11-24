// The save-slot description is a text field drawn on the canvas. Host shortcuts
// such as fullscreen listen for keys on the bubble. Stopping the event while
// that field is open keeps the letter in the field.

/** `editingSlot` is -1 when the description is not open. */
export function holdSlotKey(editingSlot: number, event: Event): void {
  if (editingSlot >= 0) event.stopPropagation();
}
