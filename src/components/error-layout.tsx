import { Button } from '@/components/ui/button';
import { Home, ArrowLeft } from 'lucide-react';

// Shared full-page layout for 404 / 500 / error states.
export function ErrorLayout({ code, title, message }: { code: string; title: string; message: string }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-4" style={{ backgroundImage: 'url(/grid.svg)', backgroundRepeat: 'repeat' }}>
      <a href="/" className="inline-flex items-center gap-2 font-mono italic font-semibold text-lg mb-10">
        <img src="/logo.svg" alt="dosya.dev logo" className="h-7 w-7" />
        dosya.dev
      </a>

      <p className="text-7xl sm:text-8xl font-extrabold tracking-tight text-muted-foreground/30 select-none mb-2">{code}</p>
      <h1 className="text-2xl sm:text-3xl font-bold mb-3">{title}</h1>
      <p className="text-muted-foreground text-base max-w-md mb-8">{message}</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <a href="/">
          <Button className="gap-2"><Home className="size-4" /> Go home</Button>
        </a>
        <Button variant="outline" className="gap-2" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" /> Go back
        </Button>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        <a href="https://status.dosya.dev" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Status</a>
        {' · '}
        <a href="https://dosya.dev/contact" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Contact support</a>
      </p>
    </div>
  );
}
