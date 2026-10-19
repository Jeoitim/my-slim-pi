import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsHttpsProxy } from '../../../extensions/timrt-suite/web-proxy.ts';
const target = 'https://api.search.brave.com/res/v1/web/search';
const config = (server, extra = '', enabled = '0x1') => `
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings
    ProxyEnable    REG_DWORD    ${enabled}
    ProxyServer    REG_SZ    ${server}
    ProxyOverride    REG_SZ    ${extra}
`;

test('enabled Windows static proxy covers HTTPS API requests', () => {
  assert.equal(windowsHttpsProxy(config('127.0.0.1:7897'), target), 'http://127.0.0.1:7897/');
  assert.equal(windowsHttpsProxy(config('127.0.0.1:7897', '', '0x0'), target), undefined);
  assert.equal(windowsHttpsProxy('', target), undefined);
});
test('protocol-specific settings use the HTTPS proxy without confusing SOCKS or HTTP', () => {
  assert.equal(windowsHttpsProxy(config('http=localhost:8000;https=localhost:8001;socks=localhost:8002'), target), 'http://localhost:8001/');
  assert.equal(windowsHttpsProxy(config('http=localhost:8000;socks=localhost:8002'), target), undefined);
  assert.equal(windowsHttpsProxy(config('https://localhost:8443'), target), 'https://localhost:8443/');
});
test('Windows bypass patterns keep excluded destinations off the proxy', () => {
  assert.equal(windowsHttpsProxy(config('localhost:7897', '*.brave.com;<local>'), target), undefined);
  assert.equal(windowsHttpsProxy(config('localhost:7897', '<local>'), 'https://intranet/search'), undefined);
  assert.equal(windowsHttpsProxy(config('localhost:7897', '*.brave.com'), 'https://api.tavily.com/search'), 'http://localhost:7897/');
  assert.equal(windowsHttpsProxy(config('localhost:7897', 'apiXsearchXbrave.com'), target), 'http://localhost:7897/');
});
test('unsupported or malformed proxy settings do not become proxy destinations', () => {
  for (const address of ['socks5://localhost:1080', 'http://localhost:7897/unexpected', 'http://localhost:99999', '']) {
    assert.equal(windowsHttpsProxy(config(address), target), undefined);
  }
  assert.equal(windowsHttpsProxy(config('localhost:7897'), 'invalid URL'), undefined);
  assert.equal(windowsHttpsProxy(config('localhost:7897'), 'http://api.search.brave.com'), undefined);
});
