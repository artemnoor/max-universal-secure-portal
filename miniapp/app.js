import { api, toClientErrorMessage } from './js/api.js';
import { escapeHtml, setText } from './js/dom.js';

const bridge = globalThis.WebApp ?? globalThis.MaxBridge;
const status = document.querySelector('#status');
const connection = document.querySelector('#connection');
const moduleCount = document.querySelector('#module-count');
const moduleGrid = document.querySelector('#module-grid');
const contractVersion = document.querySelector('#contract-version');
const footerMessage = document.querySelector('#footer-message');

if (bridge && typeof bridge.ready === 'function') bridge.ready();

const setConnection = (label, state) => {
  setText(connection, label);
  connection?.classList.remove('connection-pending', 'connection-ok', 'connection-error');
  connection?.classList.add(`connection-${state}`);
};

const renderModules = (modules) => {
  if (!moduleGrid) return;
  if (modules.length === 0) {
    moduleGrid.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">＋</span><strong>Модули ещё не подключены</strong><p>Скопируй шаблон из <code>src/modules/_template</code> и зарегистрируй ModuleDefinition в composition root.</p></div>';
    return;
  }
  moduleGrid.innerHTML = modules.map((module) => `<article class="module-card"><div class="module-card-top"><span class="module-icon" aria-hidden="true">✦</span><span class="tag">v${module.version}</span></div><h3>${escapeHtml(module.publicName)}</h3><p><code>${escapeHtml(module.id)}</code></p><span class="module-state"><i aria-hidden="true"></i> зарегистрирован</span></article>`).join('');
};

const selectView = (view) => {
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  document.querySelectorAll('[data-view]').forEach((control) => {
    const active = control.dataset.view === view;
    if (control.matches('[role="tab"]')) {
      control.classList.toggle('is-active', active);
      control.setAttribute('aria-selected', String(active));
    }
  });
  if (history.replaceState) history.replaceState(null, '', `#${view}`);
};

document.querySelectorAll('[data-view]').forEach((control) => control.addEventListener('click', () => selectView(control.dataset.view || 'overview')));

const loadPortal = async () => {
  setText(status, 'Подключаемся…');
  setConnection('Проверяем связь…', 'pending');
  try {
    const [health, info] = await Promise.all([api('/api/v1/health'), api('/api/v1/portal/info')]);
    const modules = Array.isArray(info.modules) ? info.modules : [];
    setText(status, health.status === 'ready' ? 'Портал готов' : 'Портал отвечает');
    setText(moduleCount, String(modules.length));
    setText(contractVersion, `contract v${info.contractVersion || 1}`);
    setText(footerMessage, `${info.name || 'MAX Portal'} · ${modules.length} модулей`);
    renderModules(modules);
    setConnection('Связь установлена', 'ok');
    if (globalThis.localStorage?.getItem('portal_debug') === '1') console.info('[FIX:miniapp] Portal shell loaded', { moduleCount: modules.length });
  } catch (error) {
    setText(status, 'Портал недоступен');
    setText(moduleCount, '—');
    setConnection('Нет связи', 'error');
    setText(footerMessage, toClientErrorMessage(error, 'Проверь локальный сервер и попробуй ещё раз.'));
    if (globalThis.localStorage?.getItem('portal_debug') === '1') console.warn('[FIX:miniapp] Portal shell load failed', { code: error?.code || 'NETWORK_ERROR' });
  }
};

const initialView = location.hash.replace(/^#/, '');
selectView(['overview', 'modules', 'diagnostics'].includes(initialView) ? initialView : 'overview');
void loadPortal();
