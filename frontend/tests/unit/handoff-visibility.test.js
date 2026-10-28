/**
 * Live Agent button availability — runs the real widget source in jsdom.
 * The button must stay hidden unless the site config explicitly confirms
 * handoff.enabled !== false && handoff.has_agents === true.
 */
const fs = require('fs');
const path = require('path');

const widgetSrc = fs.readFileSync(
  path.join(__dirname, '../../src/widget/chatbot.js'),
  'utf8'
);

async function flush() {
  await new Promise((r) => setTimeout(r, 50));
}

describe('Live Agent button availability (real widget source)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.__sitechatPreview = true;
    global.fetch.mockReset();
  });

  afterEach(() => {
    if (window.sitechat && window.sitechat.destroy) window.sitechat.destroy();
    delete window.sitechat;
    delete window.__sitechatPreview;
    document.body.innerHTML = '';
  });

  async function loadWidget(handoff) {
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/config')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(handoff ? { handoff } : {}),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    // eslint-disable-next-line no-eval
    eval(widgetSrc);
    await flush();
  }

  test('hidden when no agents are assigned', async () => {
    await loadWidget({ enabled: true, has_agents: false });
    const btn = document.querySelector('.sitechat-handoff-btn');
    expect(btn).not.toBeNull();
    expect(btn.style.display).toBe('none');
  });

  test('hidden when handoff is disabled', async () => {
    await loadWidget({ enabled: false, has_agents: true });
    expect(document.querySelector('.sitechat-handoff-btn').style.display).toBe('none');
  });

  test('hidden when the config omits handoff (stale backend)', async () => {
    await loadWidget(undefined);
    expect(document.querySelector('.sitechat-handoff-btn').style.display).toBe('none');
  });

  test('hidden while the config fetch is still pending', async () => {
    global.fetch.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    // eslint-disable-next-line no-eval
    eval(widgetSrc);
    await flush();
    expect(document.querySelector('.sitechat-handoff-btn').style.display).toBe('none');
  });

  test('visible when enabled and agents are assigned', async () => {
    await loadWidget({ enabled: true, has_agents: true });
    expect(document.querySelector('.sitechat-handoff-btn').style.display).toBe('');
  });
});
