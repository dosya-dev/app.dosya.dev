import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachImages } from '@/components/support/attach-images';
import { useSupportChat } from '@/stores/support-chat';
import { useT } from '@/lib/i18n';

const MAX_IMAGES = 10;
const TYPING_IDLE_MS = 3000;

/** Textarea + Screenshot + Send; replaced by a plain line for free plans. */
export function Composer() {
  const t = useT();
  const conn = useSupportChat((s) => s.conn);
  const notAvailable = useSupportChat((s) => s.notAvailable);
  const lastFailedDraft = useSupportChat((s) => s.lastFailedDraft);
  const send = useSupportChat((s) => s.send);
  const setTyping = useSupportChat((s) => s.setTyping);
  const clearFailedDraft = useSupportChat((s) => s.clearFailedDraft);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A message that failed to send comes back as editable text.
  useEffect(() => {
    if (lastFailedDraft == null) return;
    setText(lastFailedDraft);
    clearFailedDraft();
  }, [lastFailedDraft, clearFailedDraft]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  if (notAvailable) {
    return (
      <p className="border-t p-3 text-sm text-muted-foreground">
        {t('support-chat.description.liveChatIsAvailableOnPaidPlans')}
      </p>
    );
  }

  const disabled = conn === 'closed';
  const stopTyping = () => {
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; setTyping(false); }
  };
  const onChange = (v: string) => {
    setText(v);
    if (!typingTimer.current) setTyping(true);
    else clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };
  const submit = () => {
    const body = text.trim();
    if (disabled || (!body && files.length === 0)) return;
    stopTyping();
    void send(body, files);
    setText('');
    setFiles([]);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    setFiles((cur) => [...cur, ...images].slice(0, MAX_IMAGES));
  };

  return (
    <div className="border-t p-2.5 flex flex-col gap-2">
      <Textarea
        value={text}
        disabled={disabled}
        rows={2}
        placeholder={t('support-chat.placeholder.writeAMessage')}
        aria-label={t('support-chat.placeholder.writeAMessage')}
        className="min-h-12 max-h-32 resize-none"
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <AttachImages files={files} onChange={setFiles} disabled={disabled} max={MAX_IMAGES} label={t('support-chat.action.screenshot')} />
        <Button type="button" size="sm" disabled={disabled || (!text.trim() && files.length === 0)} onClick={submit}>
          <Send className="size-3.5 me-1.5 rtl:-scale-x-100" /> {t('support-chat.action.send')}
        </Button>
      </div>
    </div>
  );
}
