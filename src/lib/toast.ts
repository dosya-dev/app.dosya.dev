// Toast notifications styled after the shadcn <Alert> component:
// icon on the left, title top-right, optional description underneath.
// Rendered imperatively so it can be called from anywhere (no React context).

type ToastType = 'success' | 'error' | 'info';

const ICONS: Record<ToastType, string> = {
  // lucide circle-check
  success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  // lucide circle-alert
  error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  // lucide info
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

// success → green; error → theme destructive; info → muted foreground
const ICON_COLOR: Record<ToastType, string> = {
  success: '#16a34a',
  error: 'var(--destructive)',
  info: 'var(--muted-foreground)',
};

function getContainer(): HTMLElement {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-root';
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:calc(100vw - 40px)';
    document.body.appendChild(el);
  }
  return el;
}

function svgIcon(type: ToastType): HTMLElement {
  const span = document.createElement('span');
  span.style.cssText = `grid-column:1;grid-row:1;display:flex;color:${ICON_COLOR[type]};margin-top:1px`;
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[type]}</svg>`;
  return span;
}

function show(title: string, opts: { type?: ToastType; description?: string; duration?: number } = {}) {
  const { type = 'info', description, duration = 4000 } = opts;
  const container = getContainer();

  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = `
    display:grid;grid-template-columns:max-content 1fr;column-gap:12px;row-gap:2px;align-items:start;
    width:356px;max-width:100%;padding:12px 16px;border-radius:10px;
    border:1px solid var(--border);background:var(--card);color:var(--card-foreground);
    box-shadow:0 4px 16px rgba(0,0,0,0.12);pointer-events:auto;
    animation:toast-in 0.25s ease-out;
  `;

  el.appendChild(svgIcon(type));

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `grid-column:2;grid-row:1;font-size:13px;font-weight:600;line-height:1.35;${type === 'error' ? 'color:var(--destructive)' : ''}`;
  titleEl.textContent = title;
  el.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement('div');
    descEl.style.cssText = 'grid-column:2;grid-row:2;font-size:12px;line-height:1.45;color:var(--muted-foreground)';
    descEl.textContent = description;
    el.appendChild(descEl);
  }

  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toast-out 0.2s ease-in forwards';
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('toast-keyframes')) {
  const style = document.createElement('style');
  style.id = 'toast-keyframes';
  style.textContent = `
    @keyframes toast-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
    @keyframes toast-out { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(20px); } }
  `;
  document.head.appendChild(style);
}

const DEFAULT_TITLE: Record<ToastType, string> = {
  success: 'Success',
  error: 'Error',
  info: 'Notice',
};

// Two ways to call each:
//   toast.success('Name updated')            → title "Success",  description "Name updated"
//   toast.success('Folder created', 'Assets') → title "Folder created", description "Assets"
// Either way you always get a title + a description line.
function emit(type: ToastType, message: string, description?: string) {
  if (description !== undefined) {
    show(message, { type, description });
  } else {
    show(DEFAULT_TITLE[type], { type, description: message });
  }
}

export const toast = {
  success: (message: string, description?: string) => emit('success', message, description),
  error: (message: string, description?: string) => emit('error', message, description),
  info: (message: string, description?: string) => emit('info', message, description),
};
