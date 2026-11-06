import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { ImagePlus, X } from 'lucide-react';

const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function AttachImages({ files, onChange, disabled, max = MAX_IMAGES, label }: {
  files: File[];
  onChange: (f: File[]) => void;
  disabled?: boolean;
  /** Most images allowed; tickets use 3, live chat 10. */
  max?: number;
  /** Button text; defaults to "Attach image". */
  label?: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= max) { toast.error(t('common.error.tooManyImages'), t('common.error.atMostMaxImagesImagesPerMessage', { MAX_IMAGES: max })); break; }
      if (!ALLOWED.includes(f.type)) { toast.error(t('common.error.notAnImage'), t('common.error.onlyPngJpegWebpAndGifAreAllowed')); continue; }
      if (f.size > MAX_BYTES) { toast.error(t('common.error.imageTooLarge'), t('common.error.eachImageMustBeUnder5Mb')); continue; }
      next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {previews.map((src, i) => (
        <div key={i} className="relative">
          <img src={src} alt={files[i]?.name ?? t('common.alternative.attachment')} className="size-12 rounded-lg object-cover border" />
          <button
            type="button"
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            className="absolute -top-1.5 -inset-e-1.5 size-4 rounded-full bg-foreground text-background flex items-center justify-center"
            aria-label={t('common.action.removeImage')}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {files.length < max && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="size-3.5 me-1.5" /> {label ?? t('common.action.attachImage')}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => pick(e.target.files)}
      />
    </div>
  );
}
