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
    // No `gap` here on purpose: the 8px lives on the toast itself (see the
    // stylesheet) so it collapses with the row when one leaves. A gap on the
    // container would survive the collapse and leave a hole behind.
    el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;pointer-events:none;max-width:calc(100vw - 40px)';
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

// Slower than the generic UI budget, and `ease` rather than a strong ease-out:
// a toast is not a dropdown, and Sonner reads as elegant partly because its
// motion is tuned to the component instead of to the 200ms rule. The exit is
// quicker than the entrance on purpose - arriving is an announcement, leaving
// is just cleanup.
const ENTER_MS = 400;
const LEAVE_MS = 300;

function show(title: string, opts: { type?: ToastType; description?: string; duration?: number } = {}) {
  const { type = 'info', description, duration = 4000 } = opts;
  const container = getContainer();

  // Two elements, not one. The row owns the HEIGHT and the toast owns the
  // opacity/slide: when a toast leaves, its row collapses to 0 over the same
  // 200ms, so the toasts below slide up with it instead of teleporting the
  // moment the node is removed.
  const row = document.createElement('div');
  row.className = 'dosya-toast-row';

  const el = document.createElement('div');
  el.className = 'dosya-toast';
  el.dataset.state = 'enter';
  el.setAttribute('role', 'alert');
  if (type === 'error') el.dataset.type = 'error';

  el.appendChild(svgIcon(type));

  const titleEl = document.createElement('div');
  titleEl.className = 'dosya-toast__title';
  titleEl.textContent = title;
  el.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'dosya-toast__desc';
    descEl.textContent = description;
    el.appendChild(descEl);
  }

  row.appendChild(el);
  container.appendChild(row);

  // Two frames: one for the browser to lay the toast out in its entering
  // state, one to flip it. A transition (not a keyframe) so a toast fired
  // twice in a second retargets from where it is instead of restarting.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { delete el.dataset.state; });
  });

  setTimeout(() => {
    // Lock the row's measured height before collapsing it - `height: auto` has
    // nothing to animate from. offsetHeight includes the toast's own 8px
    // bottom margin, because overflow:hidden makes the row a BFC, so the gap
    // collapses along with the toast rather than being left behind.
    row.style.height = `${row.offsetHeight}px`;
    void row.offsetHeight; // force the locked height to take effect
    el.dataset.state = 'leave';
    row.style.height = '0px';

    let removed = false;
    const drop = () => { if (!removed) { removed = true; row.remove(); } };
    row.addEventListener('transitionend', (e) => { if (e.propertyName === 'height') drop(); });
    // Safety net: a display:none ancestor (or a browser that skips the
    // transition) never fires transitionend, and the row must not linger.
    setTimeout(drop, LEAVE_MS + 100);
  }, duration);
}

// Inject the stylesheet once. These live here rather than in index.css because
// the toast DOM is built imperatively and never passes through Tailwind - but
// the easing comes from the same --ease-out-strong token as everything else.
if (typeof document !== 'undefined' && !document.getElementById('dosya-toast-styles')) {
  const style = document.createElement('style');
  style.id = 'dosya-toast-styles';
  style.textContent = `
    /* Same curve and duration as the toast's own exit, so the collapse and the
       fade read as one motion rather than two overlapping ones. */
    .dosya-toast-row { overflow: hidden; transition: height ${LEAVE_MS}ms ease; }
    .dosya-toast {
      display: grid; grid-template-columns: max-content 1fr; column-gap: 12px; row-gap: 2px;
      align-items: start; width: 356px; max-width: 100%; margin-bottom: 8px;
      padding: 12px 16px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--card); color: var(--card-foreground);
      box-shadow: 0 4px 16px rgba(0,0,0,0.12); pointer-events: auto;
      opacity: 1; transform: translateY(0);
      transition: opacity ${ENTER_MS}ms ease, transform ${ENTER_MS}ms ease;
    }
    /* Enters and leaves through the same edge it lives on - the stack is
       pinned top-right, so it drops in from above and leaves back through the
       top. A PERCENTAGE, not a pixel count: the toast travels its own full
       height whatever its content, which is what makes the motion read. The
       old 20px slide was technically an animation and visually nothing. */
    .dosya-toast[data-state="enter"],
    .dosya-toast[data-state="leave"] { opacity: 0; transform: translateY(-100%); }
    .dosya-toast[data-state="leave"] { transition-duration: ${LEAVE_MS}ms; }
    .dosya-toast__title { grid-column: 2; grid-row: 1; font-size: 13px; font-weight: 600; line-height: 1.35; }
    .dosya-toast[data-type="error"] .dosya-toast__title { color: var(--destructive); }
    .dosya-toast__desc { grid-column: 2; grid-row: 2; font-size: 12px; line-height: 1.45; color: var(--muted-foreground); }
    @media (prefers-reduced-motion: reduce) {
      /* Keep the fade and keep the row collapse - the collapse is what stops
         the stack jumping, which is comprehension, not decoration. Only the
         sideways travel goes. */
      .dosya-toast[data-state="enter"],
      .dosya-toast[data-state="leave"] { transform: none; }
    }
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
