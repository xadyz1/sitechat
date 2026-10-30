/**
 * Conversation history restore.
 * The widget persists sessionId in localStorage; on load it must fetch the
 * stored transcript and re-render it so a reload or a second tab doesn't
 * look like a fresh chat.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/widget/chatbot.js'), 'utf8');

const HISTORY = {
  session_id: 'sess-abc',
  messages: [
    { role: 'user', content: 'hi there', sources: [], timestamp: '2026-10-30T10:00:00Z' },
    { role: 'assistant', content: 'Hello! How can I help?', sources: [], timestamp: '2026-10-30T10:00:01Z' },
    { role: 'user', content: 'show me hats', sources: [], timestamp: '2026-10-30T10:01:00Z' },
    { role: 'assistant', content: 'We have a Dad hat and a beanie.', sources: [], timestamp: '2026-10-30T10:01:02Z' },
  ],
  created_at: '2026-10-30T10:00:00Z',
  updated_at: '2026-10-30T10:01:02Z',
};

function jsonRes(data) {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}
const flush = () => new Promise(r => setTimeout(r, 0));
async function flushAll(n = 14) { for (let i = 0; i < n; i++) await flush(); }

function bootWidget(historyHandler) {
  localStorage.setItem('sitechat_session_site-x', JSON.stringify({ id: 'sess-abc', ts: Date.now() }));
  const s = document.createElement('script');
  s.src = 'http://localhost/widget/chatbot.js';
  s.dataset.siteId = 'site-x';
  s.dataset.apiUrl = 'http://localhost/api-host';
  document.head.appendChild(s);

  fetch.mockImplementation((url) => {
    url = String(url);
    if (url.includes('/api/sites/site-x/config')) {
      return jsonRes({ appearance: { chat_title: 'T' }, behavior: {} });
    }
    if (url.includes('/api/chat/history/')) return historyHandler(url);
    if (url.endsWith('/api/chat')) {
      return jsonRes({ answer: 'reply!', sources: [], confidence: 0.9, session_id: 'sess-abc' });
    }
    return jsonRes({});
  });

  // eslint-disable-next-line no-eval
  (0, eval)(SRC);
}

async function sendMessage(text) {
  const input = document.querySelector('.sitechat-input');
  const form = document.querySelector('.sitechat-input-form');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushAll(16);
}

const messageTexts = () =>
  [...document.querySelectorAll('.sitechat-message')].map(e => e.textContent);

describe('widget history restore', () => {
  test('re-renders the stored transcript in order and drops the welcome block', async () => {
    bootWidget(() => jsonRes(HISTORY));
    await flushAll();

    const texts = messageTexts();
    expect(texts.length).toBe(4);
    expect(texts[0]).toContain('hi there');
    expect(texts[1]).toContain('Hello! How can I help?');
    expect(texts[2]).toContain('show me hats');
    expect(texts[3]).toContain('We have a Dad hat');
    expect(document.querySelector('.sitechat-welcome')).toBeNull();
  });

  test('asks the API for history of the persisted session id', async () => {
    bootWidget(() => jsonRes(HISTORY));
    await flushAll();

    const urls = fetch.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/chat/history/sess-abc'))).toBe(true);
  });

  test('a new message appends after the restored transcript on the same session', async () => {
    bootWidget(() => jsonRes(HISTORY));
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('new question');

    const texts = messageTexts();
    expect(texts.length).toBe(6);
    expect(texts[4]).toContain('new question');
    expect(texts[5]).toContain('reply!');

    const chatPost = fetch.mock.calls.find(c => String(c[0]).endsWith('/api/chat'));
    expect(JSON.parse(chatPost[1].body).session_id).toBe('sess-abc');
  });

  test('empty history keeps the welcome block and chat still works', async () => {
    bootWidget(() => jsonRes({ session_id: 'sess-abc', messages: [] }));
    await flushAll();

    expect(document.querySelector('.sitechat-welcome')).toBeTruthy();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('hello');
    expect(messageTexts().some(t => t.includes('reply!'))).toBe(true);
  });

  test('history fetch failure still allows a normal conversation', async () => {
    bootWidget(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('hello');
    expect(messageTexts().some(t => t.includes('reply!'))).toBe(true);
  });

  test('restored bot messages do not bump the unread badge', async () => {
    fetch.mockImplementation((url) => {
      url = String(url);
      if (url.includes('/api/sites/site-x/config')) {
        return jsonRes({ appearance: { chat_title: 'T', launcher_badge: true }, behavior: {} });
      }
      if (url.includes('/api/chat/history/')) return jsonRes(HISTORY);
      return jsonRes({});
    });
    localStorage.setItem('sitechat_session_site-x', JSON.stringify({ id: 'sess-abc', ts: Date.now() }));
    const s = document.createElement('script');
    s.src = 'http://localhost/widget/chatbot.js';
    s.dataset.siteId = 'site-x';
    s.dataset.apiUrl = 'http://localhost/api-host';
    document.head.appendChild(s);
    (0, eval)(SRC);
    await flushAll();

    expect(document.querySelector('.sitechat-badge')).toBeNull();
  });
});
