import type { ComponentProps } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Multi-select checkbox for clickable rows/cards. Base UI's Checkbox
 * re-dispatches the click as a new bubbling event on its hidden <input>
 * sibling, so `onClick={stopPropagation}` on the Checkbox itself is not
 * enough — the re-dispatched click still reaches the row and opens the
 * folder/file the user was trying to select. The display:contents wrapper
 * contains both elements and stops every click before it hits the row,
 * without affecting layout.
 */
export function SelectCheckbox(props: ComponentProps<typeof Checkbox>) {
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <Checkbox {...props} />
    </span>
  );
}
