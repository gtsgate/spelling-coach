// Tiny DOM helpers. Never inject user data as HTML: use h() / text nodes.
import { t } from './i18n.js';

/**
 * Create an element.
 *   h('a', { href: '#/', class: 'btn', on: { click: fn }, dataset: { id }, attrs: { 'aria-label': 'x' } }, 'text', childEl)
 * Supported props: class/className, style (string|object), on (events), dataset, attrs (raw attributes),
 * any other key is set as a property when it exists on the element (value, checked, disabled, type, hidden…)
 * or as an attribute otherwise. `null`/`undefined`/`false` children are skipped; arrays are flattened.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'on') for (const [ev, fn] of Object.entries(v)) { if (fn) el.addEventListener(ev, fn); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) { if (av !== null && av !== undefined && av !== false) el.setAttribute(ak, av === true ? '' : String(av)); }
      else if (k === 'text') el.textContent = v;
      else if (k in el && !k.includes('-')) {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Bidi-isolated text (use for every personal name / user-entered text inside mixed-direction UI). */
export function bdi(text, props) {
  return h('bdi', props || null, text == null ? '' : String(text));
}

/** Remove all children. */
export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Replace the children of `el` with `children`. */
export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Short alias for querySelector within an element. */
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ---------------------------------------------------------------------------
// Icons: inline SVG (stroke = currentColor). icon('plus', {size: 18, label: 'Add'})
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  tree: 'M12 3v18M12 8l-5 3M12 8l5 3M12 14l-6 3M12 14l6 3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  home: 'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronStart: 'M15 6l-6 6 6 6',
  chevronEnd: 'M9 6l6 6-6 6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M5 12l7 7 7-7',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-2h12v2',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  warning: 'M12 3l10 18H2L12 3zM12 10v4M12 17h.01',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  github: 'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-1-2.5c3 0 6-1.5 6-6.5a5 5 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5s-1.1-.3-3.5 1.3a12 12 0 0 0-6 0C6.6 1.2 5.5 1.5 5.5 1.5a4.6 4.6 0 0 0-.1 3.5A5 5 0 0 0 4 8.5c0 5 3 6.5 6 6.5a3 3 0 0 0-1 2.5V21',
  whatsapp: 'M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20zM9 9.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2L9 9.5z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  calendar: 'M4 6h16v15H4zM4 10h16M9 3v4M15 3v4',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  merge: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-6 6',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  cake: 'M4 21h16v-8H4zM4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1.5 4 0M12 13V9M12 6.5a1.5 1.5 0 0 0 1.5-1.5C13.5 4 12 2.5 12 2.5S10.5 4 10.5 5A1.5 1.5 0 0 0 12 6.5z',
};

export function icon(name, { size = 18, label = null, className = '' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon icon-${name} ${className}`.trim());
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.info);
  svg.appendChild(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Toasts
export function toast(message, { type = 'info', action = null, timeout = 5000 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', class: 'toasts', attrs: { 'aria-live': 'polite' } });
    document.body.appendChild(host);
  }
  const el = h('div', { class: `toast toast-${type}`, attrs: { role: type === 'error' ? 'alert' : 'status' } },
    h('span', { class: 'toast-msg' }, message),
    action ? h('a', { class: 'toast-action', href: action.href || '#', on: { click: (e) => { if (action.onClick) { e.preventDefault(); action.onClick(); } dismiss(); } } }, action.label) : null,
    h('button', { class: 'toast-close', type: 'button', attrs: { 'aria-label': t('common.close') }, on: { click: () => dismiss() } }, icon('close', { size: 16 })),
  );
  host.appendChild(el);
  let timer = timeout ? setTimeout(dismiss, timeout) : null;
  function dismiss() {
    if (timer) clearTimeout(timer);
    timer = null;
    el.classList.add('toast-leave');
    setTimeout(() => el.remove(), 200);
  }
  return dismiss;
}

// ---------------------------------------------------------------------------
// Modal dialog built on <dialog>. Resolves with the value passed to close(value) (undefined on Esc / backdrop).
//   const result = await modal({ title, body: el | (close) => el, actions: [{label, value, variant:'primary'|'danger'|'ghost', onClick?(close)}], size:'sm'|'md'|'lg' })
// When an action has onClick it decides itself whether to call close(value); otherwise close(action.value).
export function modal({ title = '', body = null, actions = null, size = 'md', className = '', dismissible = true } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `modal modal-${size} ${className}`.trim(), attrs: { 'aria-label': title || null } });
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      try { dlg.close(); } catch { /* ignore */ }
      dlg.remove();
      document.body.classList.remove('modal-open');
      resolve(value);
    };
    const content = typeof body === 'function' ? body(close) : body;
    const footer = actions && actions.length
      ? h('footer', { class: 'modal-actions' }, actions.map((a) => h('button', {
          type: 'button',
          class: `btn ${a.variant ? 'btn-' + a.variant : ''}`.trim(),
          disabled: !!a.disabled,
          dataset: a.id ? { action: a.id } : undefined,
          on: { click: () => (a.onClick ? a.onClick(close) : close(a.value)) },
        }, a.icon ? icon(a.icon) : null, a.label)))
      : null;
    dlg.append(
      h('header', { class: 'modal-header' },
        h('h2', { class: 'modal-title' }, title),
        dismissible ? h('button', { type: 'button', class: 'btn-icon modal-close', attrs: { 'aria-label': t('common.close') }, on: { click: () => close(undefined) } }, icon('close')) : null),
      h('div', { class: 'modal-body' }, content),
      footer,
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(undefined); });
    dlg.addEventListener('click', (e) => { if (dismissible && e.target === dlg) close(undefined); });
    document.body.appendChild(dlg);
    document.body.classList.add('modal-open');
    dlg.showModal();
    const focusable = dlg.querySelector('[autofocus], .modal-body input, .modal-body select, .modal-body textarea, .modal-body button');
    if (focusable) focusable.focus();
  });
}

/** Simple confirm dialog → Promise<boolean>. */
export async function confirmDialog({ title, message, confirmLabel = t('common.confirm'), cancelLabel = t('common.cancel'), danger = false }) {
  const v = await modal({
    title,
    size: 'sm',
    body: h('p', null, message),
    actions: [
      { label: cancelLabel, value: false, variant: 'ghost' },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

/** Copy text to clipboard with a fallback. Resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;inset-inline-start:-9999px' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Debounce helper. */
export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/** Build a hash link: link('p', id) → '#/p/<id>'. */
export function href(...parts) {
  return '#/' + parts.filter((p) => p !== undefined && p !== null && p !== '').map((p) => encodeURIComponent(p)).join('/');
}
