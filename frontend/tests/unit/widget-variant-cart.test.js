/**
 * Variant-aware add-to-cart for product cards.
 * When a card's PDP exposes several variants (#pdp-variants radio inputs),
 * clicking "Add to cart" must open the picker modal instead of silently
 * adding the default variant.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/widget/chatbot.js'), 'utf8');

const PDP_HTML = `<!DOCTYPE html><html><body>
<div class="variant-list" id="pdp-variants">
  <label><input type="radio" name="variant" value="20" data-price="32.50" checked><img class="vthumb" src="/a.webp">Black / M · €32,50</label>
  <label><input type="radio" name="variant" value="21" data-price="32.50"><img class="vthumb" src="/b.webp">Red / L · €32,50</label>
</div></body></html>`;

const PRODUCT = {
  name: 'Oversized faded t-shirt',
  url: 'http://localhost/produto/oversized-faded-t-shirt',
  image: 'http://localhost/img/t.webp',
  price: 32.5,
  currency: 'EUR',
  product_id: '20',
  cart_url: 'http://localhost/cart/add?variant=20&qty=1',
  cart_label: 'Add to cart',
};

function jsonRes(data) {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}
function htmlRes(html) {
  return Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(html),
    json: () => Promise.reject(new Error('not json')),
  });
}
const flush = () => new Promise(r => setTimeout(r, 0));
async function flushAll(n = 8) { for (let i = 0; i < n; i++) await flush(); }

function bootWidget() {
  const s = document.createElement('script');
  s.src = 'http://localhost/widget/chatbot.js';
  s.dataset.siteId = 'site-x';
  s.dataset.apiUrl = 'http://localhost/api-host';
  document.head.appendChild(s);

  fetch.mockImplementation((url) => {
    url = String(url);
    if (url.includes('/api/sites/site-x/config')) {
      return jsonRes({
        appearance: { chat_title: 'T', primary_color: '#e63a46', launcher_style: 'float_button', welcome_enabled: false },
        behavior: { product_cards: true },
      });
    }
    if (url.endsWith('/api/chat')) {
      return jsonRes({ answer: 'here you go', sources: [], confidence: 0.9, session_id: 'sess', products: [PRODUCT] });
    }
    if (url.includes('/produto/')) return htmlRes(PDP_HTML);
    if (url.includes('/cart/add')) return jsonRes({ ok: true });
    return jsonRes({});
  });

  // eslint-disable-next-line no-eval
  (0, eval)(SRC);
}

async function sendMessage(text) {
  const form = document.querySelector('.sitechat-input-form');
  const input = document.querySelector('.sitechat-input');
  expect(form).toBeTruthy();
  expect(input).toBeTruthy();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushAll(12);
}

describe('widget variant-aware add-to-cart', () => {
  test('variable product opens picker modal and adds the chosen variant natively', async () => {
    window.addToCart = jest.fn().mockResolvedValue(undefined);
    bootWidget();
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('show me t-shirts');

    const cartBtn = document.querySelector('.sitechat-product-btn.primary');
    expect(cartBtn).toBeTruthy();
    cartBtn.click();
    await flushAll();

    // Modal with both PDP variants should appear
    const opts = document.querySelectorAll('.sitechat-vpick-opt');
    expect(opts.length).toBe(2);
    expect(window.addToCart).not.toHaveBeenCalled();

    // Pick variant 21 → native addToCart(vid) call
    opts[1].click();
    await flushAll();
    expect(window.addToCart).toHaveBeenCalledWith(21, 1);
    expect(document.querySelector('.sitechat-vpick-overlay')).toBeNull();

    delete window.addToCart;
  });

  test('without a native addToCart, the picked variant rewrites the cart deep-link', async () => {
    delete window.addToCart;
    bootWidget();
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('show me t-shirts');

    document.querySelector('.sitechat-product-btn.primary').click();
    await flushAll();

    const opts = document.querySelectorAll('.sitechat-vpick-opt');
    expect(opts.length).toBe(2);
    opts[0].click();
    await flushAll();

    const cartCalls = fetch.mock.calls.filter(c => String(c[0]).includes('/cart/add'));
    expect(cartCalls.length).toBe(1);
    expect(String(cartCalls[0][0])).toContain('variant=20');
  });

  test('card without cart_url still gets an add button when the shop has addToCart', async () => {
    window.addToCart = jest.fn().mockResolvedValue(undefined);
    const noCartProduct = Object.assign({}, PRODUCT, { cart_url: null, product_id: null });
    fetch.mockImplementation((url) => {
      url = String(url);
      if (url.includes('/api/sites/site-x/config')) {
        return jsonRes({ appearance: { chat_title: 'T', welcome_enabled: false }, behavior: {} });
      }
      if (url.endsWith('/api/chat')) {
        return jsonRes({ answer: 'x', sources: [], confidence: 0.9, session_id: 's', products: [noCartProduct] });
      }
      if (url.includes('/produto/')) return htmlRes(PDP_HTML);
      return jsonRes({});
    });
    const s = document.createElement('script');
    s.src = 'http://localhost/widget/chatbot.js';
    s.dataset.siteId = 'site-x';
    s.dataset.apiUrl = 'http://localhost/api-host';
    document.head.appendChild(s);
    (0, eval)(SRC);
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('show me t-shirts');

    const cartBtn = document.querySelector('.sitechat-product-btn.primary');
    expect(cartBtn).toBeTruthy();
    cartBtn.click();
    await flushAll();

    document.querySelectorAll('.sitechat-vpick-opt')[1].click();
    await flushAll();
    expect(window.addToCart).toHaveBeenCalledWith(21, 1);
    delete window.addToCart;
  });

  test('single-variant PDP adds directly without a modal', async () => {
    window.addToCart = jest.fn().mockResolvedValue(undefined);
    fetch.mockImplementation((url) => {
      url = String(url);
      if (url.includes('/api/sites/site-x/config')) {
        return jsonRes({ appearance: { chat_title: 'T', welcome_enabled: false }, behavior: {} });
      }
      if (url.endsWith('/api/chat')) {
        return jsonRes({ answer: 'x', sources: [], confidence: 0.9, session_id: 's', products: [PRODUCT] });
      }
      if (url.includes('/produto/')) {
        return htmlRes('<div id="pdp-variants"><label><input type="radio" name="variant" value="33" checked>One · €10,00</label></div>');
      }
      return jsonRes({});
    });
    const s = document.createElement('script');
    s.src = 'http://localhost/widget/chatbot.js';
    s.dataset.siteId = 'site-x';
    s.dataset.apiUrl = 'http://localhost/api-host';
    document.head.appendChild(s);
    (0, eval)(SRC);
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('x');
    document.querySelector('.sitechat-product-btn.primary').click();
    await flushAll();

    expect(document.querySelector('.sitechat-vpick-overlay')).toBeNull();
    expect(window.addToCart).toHaveBeenCalledWith(33, 1);
    delete window.addToCart;
  });

  test('[prod:name] tags never reach the rendered message', async () => {
    fetch.mockImplementation((url) => {
      url = String(url);
      if (url.includes('/api/sites/site-x/config')) {
        return jsonRes({ appearance: { chat_title: 'T', welcome_enabled: false }, behavior: {} });
      }
      if (url.endsWith('/api/chat')) {
        return jsonRes({ answer: 'Temos o Dad Hat\n[prod:Dad Hat]', sources: [], confidence: 0.9, session_id: 's', products: [] });
      }
      return jsonRes({});
    });
    const s = document.createElement('script');
    s.src = 'http://localhost/widget/chatbot.js';
    s.dataset.siteId = 'site-x';
    s.dataset.apiUrl = 'http://localhost/api-host';
    document.head.appendChild(s);
    (0, eval)(SRC);
    await flushAll();

    document.querySelector('.sitechat-toggle').click();
    await sendMessage('chapeus');

    const msgs = document.querySelector('.sitechat-messages');
    expect(msgs.textContent).toContain('Dad Hat');
    expect(msgs.textContent).not.toContain('[prod:');
  });
});
