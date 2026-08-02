// The demos use the same Lucide icon set the real dosya apps ship
// (apps/web + apps/desktop both depend on lucide-react). These thin
// aliases keep the demo's own icon names stable while rendering the exact
// same glyphs as the product, and default to aria-hidden since every icon
// here is decorative (paired with a text label or an aria-labelled button).
import {
  Folder,
  File,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
  Upload,
  Share2,
  Check,
  X,
  Eye,
  Palette,
  RefreshCw,
  type LucideProps,
} from 'lucide-react';

const wrap = (Icon: React.ComponentType<LucideProps>) =>
  function DemoIcon(props: LucideProps) {
    return <Icon aria-hidden {...props} />;
  };

export const IconFolder = wrap(Folder);
export const IconFile = wrap(File);
export const IconUp = wrap(ArrowUp);
export const IconDown = wrap(ArrowDown);
export const IconGrid = wrap(LayoutGrid);
export const IconList = wrap(List);
export const IconUpload = wrap(Upload);
export const IconShare = wrap(Share2);
export const IconCheck = wrap(Check);
export const IconX = wrap(X);
export const IconEye = wrap(Eye);
export const IconPalette = wrap(Palette);
export const IconRefresh = wrap(RefreshCw);
