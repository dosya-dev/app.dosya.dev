import { SWATCHES, resolveSwatch } from '@/lib/palette';

/**
 * The colour picker for anything that carries an identity colour: a workspace, a folder
 * group. There used to be five of these, each with a different set of hexes, all writing
 * to the same free-form database column.
 *
 * Selection is resolved by swatch, not by string equality. `workspaces.icon_color` has
 * never been validated server-side, so a workspace created by an older client holds a
 * hex that is not in this list; comparing `value === swatch.light` would show nothing as
 * selected and silently change the colour the moment the user saved anything else on the
 * page. `resolveSwatch` maps every colour any picker ever offered back to its swatch.
 *
 * The value written is the light-theme fill, because the stored hex is also rendered by
 * surfaces that have no theme at all - notification e-mails, in particular.
 */
export function SwatchPicker({
  value,
  onChange,
  size = 'md',
  shape = 'circle',
  disabled,
  label = 'Colour',
}: {
  value: string;
  onChange: (hex: string) => void;
  size?: 'sm' | 'md';
  shape?: 'circle' | 'square';
  disabled?: boolean;
  label?: string;
}) {
  const selected = resolveSwatch(value);
  const box = size === 'sm' ? 'size-5' : 'size-7';
  const corner = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  const ring = size === 'sm' ? 'ring-2 ring-offset-1' : 'ring-2 ring-offset-2';

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {SWATCHES.map((s) => {
        const isOn = selected ? selected === s.name : value === s.light;
        return (
          <button
            key={s.name}
            type="button"
            role="radio"
            aria-checked={isOn}
            aria-label={s.label}
            title={s.label}
            disabled={disabled}
            onClick={() => onChange(s.light)}
            className={`${box} ${corner} transition-transform ${
              isOn ? `${ring} ring-foreground` : 'hover:scale-110'
            } disabled:opacity-50 disabled:hover:scale-100`}
            style={{ background: s.light }}
          />
        );
      })}
    </div>
  );
}
