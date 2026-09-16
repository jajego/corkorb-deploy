import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Real React hook, controlled Clerk readiness/token timing and socket events.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { useOrbWebSocket } from './src/hooks/useOrbWebSocket';
    window.auth = {isLoaded: !!window.initiallyReady, sessionId: 'session', getToken: () => new Promise((resolve, reject) => window.tokens.push({resolve, reject}))};
    window.profile = {isLoaded: !!window.initiallyReady};
    window.tokens = []; window.sockets = []; window.errors = []; window.states = [];
    window.options = {orbId: 'first', username: null, onError: e => window.errors.push(e), onState: s => window.states.push(s)};
    window.WebSocket = class {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = 0; sent = [];
      constructor(url) { this.url = url; window.sockets.push(this); }
      close() { this.readyState = 3; }
      send(data) { this.sent.push(JSON.parse(data)); }
      open() { this.readyState = 1; this.onopen?.(); }
      message(data) { this.onmessage?.({data: JSON.stringify(data)}); }
    };
    function App() { window.hook = useOrbWebSocket(window.options); return null; }
    const root = createRoot(document.getElementById('root'));
    window.render = () => flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
    window.unmount = () => flushSync(() => root.unmount());
    window.render();
  ` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'clerk-stub', setup(b) {
    b.onResolve({filter: /^@clerk\/react$/}, () => ({path: 'clerk', namespace: 'stub'}))
    b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const useAuth = () => window.auth; export const useUser = () => window.profile;'}))
  } }],
})
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE})
try {
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({content: bundle.outputFiles[0].text})
  assert.equal(await page.evaluate(() => tokens.length), 0)
  await page.evaluate(() => { auth.isLoaded = true; render() })
  assert.equal(await page.evaluate(() => tokens.length), 0, 'Wait for profile, too')
  await page.evaluate(() => { profile.isLoaded = true; options.username = 'Jamie'; render(); hook.connect(); hook.connect() })
  assert.equal(await page.evaluate(() => tokens.length), 1, 'Deduplicate while awaiting token')
  await page.evaluate(() => tokens[0].resolve('token'))
  assert.equal(await page.evaluate(() => sockets.length), 1)
  assert.match(await page.evaluate(() => sockets[0].url), /username=Jamie/)
  await page.evaluate(() => { sockets[0].open(); options.orbId = 'second'; render() })
  await page.evaluate(() => { options.orbId = 'third'; render() })
  await page.evaluate(() => tokens[1].resolve('stale'))
  assert.equal(await page.evaluate(() => sockets.length), 1, 'Cancelled auth must not open a socket')
  await page.evaluate(() => { hook.connect(); tokens[2].resolve('current') })
  assert.equal(await page.evaluate(() => tokens.length), 3, 'Stale completion must not unlock newer attempt')
  await page.evaluate(() => {
    sockets[1].open();
    window.response = hook.sendMessage({type: 'test'}, true).then(() => 'resolved', () => 'rejected');
    sockets[0].onerror({}); sockets[0].onclose({code: 1006}); sockets[0].onopen();
    sockets[0].message({type: 'state', papers: ['stale']});
    sockets[1].message({type: 'success', request_id: sockets[1].sent.at(-1).request_id, data: {type: 'test'}});
  })
  assert.equal(await page.evaluate(() => response), 'resolved', 'Old close cannot reject active requests')
  assert.equal(await page.evaluate(() => hook.status), 'connected')
  assert.deepEqual(await page.evaluate(() => errors), [])
  assert.deepEqual(await page.evaluate(() => states), [])
  await page.evaluate(() => { sockets[1].onerror({}); sockets[1].readyState = 3; sockets[1].onclose({code: 1006}) })
  assert.deepEqual(await page.evaluate(() => errors), ['WebSocket error'], 'Real errors remain visible')
  await page.waitForFunction(() => tokens.length === 4)
  await page.evaluate(() => { unmount(); tokens[3].resolve('late') })
  assert.equal(await page.evaluate(() => sockets.length), 2, 'Unmount cancels pending retry')
  const readyPage = await browser.newPage()
  await readyPage.setContent('<div id="root"></div>')
  await readyPage.evaluate(() => { window.initiallyReady = true })
  await readyPage.addScriptTag({content: bundle.outputFiles[0].text})
  assert.equal(await readyPage.evaluate(() => tokens.length), 2, 'StrictMode replays ready mount')
  await readyPage.evaluate(() => { tokens[0].resolve('stale'); tokens[1].resolve('signed-in') })
  assert.equal(await readyPage.evaluate(() => sockets.length), 1, 'StrictMode must open only one socket')
  await readyPage.evaluate(() => { sockets[0].open(); auth.sessionId = null; render() })
  await readyPage.evaluate(() => tokens[2].resolve(null))
  assert.equal(await readyPage.evaluate(() => sockets[1].url), 'ws://localhost:8000/ws/orb/first', 'Sign-out connects anonymously')
  await readyPage.evaluate(() => { sockets[1].open(); auth.sessionId = 'new-session'; render() })
  await readyPage.evaluate(() => tokens[3].resolve('new-token'))
  assert.match(await readyPage.evaluate(() => sockets[2].url), /token=new-token/)
  await readyPage.evaluate(() => {
    sockets[2].open();
    auth.getToken = () => Promise.resolve('refreshed'); render();
  })
  assert.equal(await readyPage.evaluate(() => sockets.length), 3, 'Token getter identity changes must not reconnect')
  await readyPage.evaluate(() => { options.enabled = false; render(); hook.connect() })
  assert.equal(await readyPage.evaluate(() => sockets[2].readyState), 3)
  assert.equal(await readyPage.evaluate(() => sockets.length), 3, 'Disabled hook stays disconnected')
  assert.deepEqual(await readyPage.evaluate(() => errors), [])
  await readyPage.evaluate(() => unmount())
  console.log('Passed: auth readiness, ready StrictMode mount, overlapping attempts, stale token/events, real errors, retry, unmount, sign-out/sign-in, token getter changes, disable.')
} finally { await browser.close() }
