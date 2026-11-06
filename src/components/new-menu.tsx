import { ChevronDown, FileCode, FileText, FileType, FolderPlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import type { NewFileKind } from '@/lib/blank-files';

/**
 * The files toolbar's "New" button: a folder, or a blank Markdown, text or
 * Word file in the current folder. Each choice is passed only when the role
 * can do it (`onNewFolder` needs create_folders, `onNewFile` upload_files);
 * the whole button is gone when neither is. Items read short ("Folder")
 * under the "New" button; their accessible names say the whole thing.
 */
export function NewMenu({ onNewFolder, onNewFile }: {
  onNewFolder?: () => void;
  onNewFile?: (kind: NewFileKind) => void;
}) {
  const t = useT();
  if (!onNewFolder && !onNewFile) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" />}>
        <Plus className="size-3.5" /> {t('files.action.new')} <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {onNewFolder && <DropdownMenuItem aria-label={t('common.action.newFolder')} onClick={onNewFolder}><FolderPlus className="size-3.5 me-2" /> {t('common.label.folder')}</DropdownMenuItem>}
        {onNewFile && (
          <>
            <DropdownMenuItem aria-label={t('files.heading.newMarkdownFile')} onClick={() => onNewFile('md')}><FileCode className="size-3.5 me-2" /> {t('files.action.markdownFile')}</DropdownMenuItem>
            <DropdownMenuItem aria-label={t('files.heading.newTextFile')} onClick={() => onNewFile('txt')}><FileText className="size-3.5 me-2" /> {t('files.action.textFile')}</DropdownMenuItem>
            <DropdownMenuItem aria-label={t('files.heading.newWordDocument')} onClick={() => onNewFile('docx')}><FileType className="size-3.5 me-2" /> {t('files.action.wordDocument')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
