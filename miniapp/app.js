const status = document.querySelector('#status');
const bridge = globalThis.WebApp ?? globalThis.MaxBridge;
if (bridge && typeof bridge.ready === 'function') bridge.ready();
if (status) status.textContent = 'Каркас готов к подключению модулей.';
