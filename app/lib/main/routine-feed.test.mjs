import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { RoutineFeed } = require('./routine-feed');

function fixture() {
  const sockets = [], events = [], statuses = [], timers = new Set();
  class Socket {
    constructor() { sockets.push(this); this.sent = []; }
    send(value) { this.sent.push(value); }
    close() { this.closing = true; } // WebSocket close callback is asynchronous.
    open() { this.onopen(); }
    message(value) { this.onmessage({ data: JSON.stringify(value) }); }
  }
  const feed = new RoutineFeed({ url: 'ws://127.0.0.1/fixture', token: 'synthetic', readyFeed: 'routines',
    WebSocketImpl: Socket, onEvent: event => events.push(event), onStatus: state => statuses.push(state.state),
    setTimeoutImpl(callback) { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeoutImpl(timer) { timers.delete(timer); },
  });
  const ready = socket => { socket.open(); socket.message({ type: 'feed-ready', feed: 'routines' }); };
  return { feed, sockets, events, statuses, timers, ready };
}

test('late socket events after stop cannot dispatch notifications or report a new connection', () => {
  const f = fixture();
  f.feed.start();
  const old = f.sockets[0];
  f.ready(old);
  f.feed.stop();
  const before = [...f.statuses];
  old.message({ type: 'routine-fired', routine_id: 'old' });
  old.open();
  old.onclose();
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.statuses, before);
  assert.equal(f.timers.size, 0);
});

test('old close after stop/start cannot discard the replacement socket or its ready handshake', () => {
  const f = fixture();
  f.feed.start();
  const old = f.sockets[0];
  f.ready(old);
  f.feed.stop();
  f.feed.start();
  const replacement = f.sockets[1];
  replacement.open();
  old.onclose();
  old.message({ type: 'routine-fired', routine_id: 'old' });
  replacement.message({ type: 'routine-fired', routine_id: 'before-ready' });
  replacement.message({ type: 'feed-ready', feed: 'routines' });
  replacement.message({ type: 'routine-fired', routine_id: 'current' });
  assert.deepEqual(f.events, [{ type: 'routine-fired', routine_id: 'current' }]);
  assert.equal(f.statuses.at(-1), 'connected');
  assert.equal(f.timers.size, 0);
  f.feed.stop();
  assert.equal(replacement.closing, true);
});

test('current connection loss still retries and accepts the next ready connection', () => {
  const f = fixture();
  f.feed.start();
  f.ready(f.sockets[0]);
  f.sockets[0].onclose();
  assert.equal(f.statuses.at(-1), 'retrying');
  const timer = [...f.timers][0];
  f.timers.delete(timer);
  timer.callback();
  f.ready(f.sockets[1]);
  f.sockets[1].message({ type: 'routine-fired', routine_id: 'fresh' });
  assert.deepEqual(f.events, [{ type: 'routine-fired', routine_id: 'fresh' }]);
  assert.equal(f.statuses.at(-1), 'connected');
  f.feed.stop();
});
