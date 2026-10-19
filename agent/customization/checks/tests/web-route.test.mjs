import test from 'node:test';
import assert from 'node:assert/strict';
import { runWeb, fallbackOrder } from '../../../extensions/timrt-suite/web-route.ts';
const hit = { content: [{ type: 'text', text: 'Title: Official docs\nURL: https://pi.dev/docs/latest/extensions\nPi supports extensions.' }] };
const response = { results: [{ title: 'Official docs', url: 'https://pi.dev', content: 'Documentation' }], usage: { credits: 1 } };
const search = { action: 'search', query: 'Pi extension docs' };
const unexpected = async () => { throw new Error('Unexpected API request'); };
const allKeys = { brave: 'brave-test-only', tavily: 'tavily-test-only', exa: 'exa-test-only' };
const braveResponse = { web: { results: [{ title: 'Official docs', url: 'https://pi.dev', description: 'Pi documentation', extra_snippets: ['Extension API reference.'] }] } };

test('free MCP succeeds without touching API credits', async () => {
  const result = await runWeb(search, { keys: { tavily: 'test-only' }, mcp: async (_action, input) => { assert.ok(input.objective); return hit; }, post: unexpected });
  assert.equal(result.provider, 'exa-mcp');
});
test('rate limit falls back to Tavily basic with no automatic advanced upgrade', async () => {
  const result = await runWeb(search, { keys: { tavily: 'test-only' }, mcp: async () => ({ isError: true, content: [] }), post: async (url, key, input) => {
    assert.equal(url, 'https://api.tavily.com/search'); assert.equal(key, 'test-only'); assert.equal(input.search_depth, 'basic'); assert.equal(input.auto_parameters, false); return response;
  } });
  assert.equal(result.provider, 'tavily'); assert.equal(result.credits, 1); assert.match(result.text, /Fallback:/);
});
test('empty results also fall back', async () => {
  const result = await runWeb(search, { keys: { tavily: 'test-only' }, mcp: async () => ({ content: [{ type: 'text', text: 'No search results found' }] }), post: async () => response });
  assert.equal(result.provider, 'tavily');
});
test('semantic quality retry explicitly uses a different engine', async () => {
  const result = await runWeb({ ...search, provider: 'tavily' }, { keys: { tavily: 'test-only' }, mcp: unexpected, post: async () => response });
  assert.equal(result.provider, 'tavily');
});
test('optional keyed Exa is the last fallback', async () => {
  const result = await runWeb(search, { keys: { tavily: 'test-only', exa: 'test-only' }, mcp: async () => { throw new Error('MCP unavailable'); }, post: async url => {
    if (url.includes('tavily')) throw new Error('HTTP 429'); return response;
  } });
  assert.equal(result.provider, 'exa-api');
});
test('missing key returns setup guidance', async () => {
  await assert.rejects(runWeb({ ...search, provider: 'tavily' }, { keys: {}, mcp: unexpected, post: unexpected }), /Pi-Maintenance.bat/);
});
test('cancellation does not spend fallback credits', async () => {
  const controller = new AbortController();
  await assert.rejects(runWeb(search, { keys: { tavily: 'test-only' }, mcp: async () => { controller.abort(); throw new Error('aborted'); }, post: unexpected }, controller.signal), { name: 'AbortError' });
});
test('read routes to basic extraction and preserves source URL', async () => {
  const result = await runWeb({ action: 'read', urls: ['https://pi.dev'], provider: 'tavily' }, { keys: { tavily: 'test-only' }, mcp: unexpected, post: async (url, _key, body) => {
    assert.equal(url, 'https://api.tavily.com/extract'); assert.equal(body.extract_depth, 'basic'); return response;
  } });
  assert.match(result.text, /https:\/\/pi.dev/);
});
test('invalid URLs and empty search fail before network access', async () => {
  await assert.rejects(runWeb({ action: 'read', urls: ['file:///C:/test'] }, { keys: {}, mcp: unexpected, post: unexpected }), /HTTP/);
  await assert.rejects(runWeb({ action: 'search' }, { keys: {}, mcp: unexpected, post: unexpected }), /query/);
});

test('Brave is the general-search fallback and success stops the other APIs', async () => {
  let requests = 0, mcpRequests = 0;
  const result = await runWeb(search, { keys: allKeys, mcp: async () => { mcpRequests++; throw Error('MCP unavailable'); }, post: async (url, key, body) => {
    requests++;
    assert.equal(url, 'https://api.search.brave.com/res/v1/web/search');
    assert.equal(key, allKeys.brave);
    assert.equal(body.q, search.query);
    assert.equal(body.count, 5);
    assert.equal(body.extra_snippets, true);
    assert.equal(body.text_decorations, false);
    return braveResponse;
  } });
  assert.equal(result.provider, 'brave');
  assert.equal(mcpRequests, 1);
  assert.equal(requests, 1);
  assert.match(result.text, /Extension API reference/);
  assert.match(result.text, /https:\/\/pi.dev/);
});

test('query intent selects different first fallbacks without a classifier request', async () => {
  for (const [query, expected] of [
    ['今天的科技新闻', 'brave'],
    ['比较 Rust 与 Go 的优缺点', 'tavily'],
    ['Transformer semantic search papers arxiv', 'exa-api'],
  ]) {
    const requests = [];
    const result = await runWeb({ action: 'search', query }, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async url => {
      requests.push(url);
      return url.includes('brave.com') ? braveResponse : response;
    } });
    assert.equal(result.provider, expected, query);
    assert.equal(requests.length, 1, 'only the chosen fallback should consume credits');
  }
});

test('all three APIs are tried serially only after preceding failures', async () => {
  const order = [];
  let running = false;
  const result = await runWeb(search, { keys: allKeys, mcp: async () => { order.push('mcp'); throw Error('MCP unavailable'); }, post: async url => {
    assert.equal(running, false, 'no parallel fan-out');
    running = true;
    const provider = url.includes('brave.com') ? 'brave' : url.includes('tavily') ? 'tavily' : 'exa-api';
    order.push(provider);
    await Promise.resolve();
    running = false;
    if (provider !== 'exa-api') throw Error('HTTP 429');
    return response;
  } });
  assert.deepEqual(order, ['mcp', 'brave', 'tavily', 'exa-api']);
  assert.equal(result.provider, 'exa-api');
});

test('relevance fallback skips MCP and prefers an independent index before Exa API', async () => {
  const requests = [];
  const result = await runWeb({ action: 'search', query: 'semantic search papers', provider: 'fallback' }, {
    keys: allKeys, mcp: unexpected, post: async url => { requests.push(url); return response; },
  });
  assert.equal(result.provider, 'tavily');
  assert.equal(requests.length, 1);
  assert.deepEqual(fallbackOrder({ action: 'search', query: 'ordinary search' }, { exa: 'test-only' }), ['exa-api']);
});

test('URL reads omit Brave and explicitly requesting Brave read never reaches network', async () => {
  const read = { action: 'read', urls: ['https://pi.dev'] };
  const result = await runWeb(read, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async url => {
    assert.equal(url, 'https://api.tavily.com/extract');
    return response;
  } });
  assert.equal(result.provider, 'tavily');
  await assert.rejects(runWeb({ ...read, provider: 'brave' }, { keys: allKeys, mcp: unexpected, post: unexpected }), /search-only/);
});

test('malformed or flagged-low-quality Brave results fall through to Tavily', async () => {
  for (const data of [
    { web: { results: [] } },
    { web: { results: [{ title: 'Bad', url: 'file:///C:/secret' }] } },
    { web: { results: [{ title: 'Bad', url: 'https://user:pass@example.com' }] } },
    { ...braveResponse, query: { bad_results: true } },
  ]) {
    const result = await runWeb(search, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async url => url.includes('brave.com') ? data : response });
    assert.equal(result.provider, 'tavily');
  }
});

test('non-result MCP status text with no source link falls back', async () => {
  const result = await runWeb(search, { keys: allKeys, mcp: async () => ({ content: [{ type: 'text', text: 'The service is temporarily unavailable.' }] }), post: async () => braveResponse });
  assert.equal(result.provider, 'brave');
});

test('Brave query limits skip unsupported auto requests without truncating the query', async () => {
  for (const query of ['字'.repeat(601), Array(76).fill('word').join(' ')]) {
    const result = await runWeb({ action: 'search', query }, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async (url, _key, body) => {
      assert.equal(url, 'https://api.tavily.com/search');
      assert.equal(body.query, query);
      return response;
    } });
    assert.equal(result.provider, 'tavily');
    await assert.rejects(runWeb({ action: 'search', query, provider: 'brave' }, { keys: allKeys, mcp: unexpected, post: unexpected }), /600 characters and 75 words/);
  }
});

test('upstream error messages cannot echo configured credentials into fallback results', async () => {
  const result = await runWeb(search, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async url => {
    if (url.includes('brave.com')) throw Error('X-Subscription-Token: ' + allKeys.brave);
    return response;
  } });
  for (const key of Object.values(allKeys)) assert.ok(!result.text.includes(key));
  assert.match(result.text, /redacted/);
});

test('cancellation during Brave prevents Tavily and Exa credit spending', async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(runWeb(search, { keys: allKeys, mcp: async () => { throw Error('MCP unavailable'); }, post: async url => {
    requests++;
    assert.ok(url.includes('brave.com'));
    controller.abort();
    throw Error('cancelled');
  } }, controller.signal), { name: 'AbortError' });
  assert.equal(requests, 1);
});
