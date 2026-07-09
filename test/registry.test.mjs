import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreRegistry, isStoreLike } from '../src/page-agent/reduxRegistry.js';

function makeStore(initial) {
  let state = initial;
  const listeners = [];
  return {
    getState: () => state,
    dispatch(action) {
      if (action.type === 'set') state = action.state;
      for (const l of listeners) l();
      return action;
    },
    subscribe(l) {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
  };
}

test('isStoreLike checks the store shape', () => {
  assert.ok(isStoreLike(makeStore({})));
  assert.ok(!isStoreLike({ getState() {} }));
  assert.ok(!isStoreLike(null));
  assert.ok(!isStoreLike('store'));
});

test('register dedupes middleware-wrapped stores sharing getState', () => {
  const registry = createStoreRegistry(() => {}, () => false);
  const base = makeStore({});
  const wrapped = { ...base, dispatch: (a) => base.dispatch(a) }; // applyMiddleware shape
  const id1 = registry.register(base, { tier: 1 });
  const id2 = registry.register(wrapped, { tier: 3 });
  assert.equal(id1, id2);
  assert.equal(registry.list().length, 1);
});

test('a store stays deduped on rescan after an ephemeral edit patched getState', () => {
  const registry = createStoreRegistry(() => {}, () => true);
  const store = makeStore({ a: 1 });
  const id = registry.register(store, { tier: 3 });
  registry.edit(id, ['a'], 2);
  const idAgain = registry.register(store, { tier: 3 });
  assert.equal(idAgain, id);
  assert.equal(registry.list().length, 1);
});

test('register dedupes by store identity and upgrades tier', () => {
  const registry = createStoreRegistry(() => {}, () => false);
  const store = makeStore({});
  const id1 = registry.register(store, { tier: 3 });
  const id2 = registry.register(store, { tier: 1 });
  assert.equal(id1, id2);
  assert.equal(registry.list()[0].tier, 1);
});

test('ephemeral edit patches getState, pokes subscribers, and clears on real dispatch', () => {
  const sent = [];
  const registry = createStoreRegistry((m) => sent.push(m), () => true);
  const store = makeStore({ user: { name: 'ada', age: 36 } });
  const id = registry.register(store, { tier: 3 });

  let notified = 0;
  store.subscribe(() => notified++);

  const mode = registry.edit(id, ['user', 'name'], 'grace');
  assert.equal(mode, 'ephemeral');
  assert.equal(notified, 1, 'subscribers poked so UIs re-read state');
  assert.deepEqual(store.getState(), { user: { name: 'grace', age: 36 } });

  // A real action clears the override; the store's own state wins again.
  store.dispatch({ type: 'set', state: { user: { name: 'real', age: 1 } } });
  assert.deepEqual(store.getState(), { user: { name: 'real', age: 1 } });
});

test('ephemeral override clears when middleware-internal dispatch changes real state', () => {
  const registry = createStoreRegistry(() => {}, () => true);
  const store = makeStore({ n: 1 });
  // Middleware closures capture the enhanced dispatch BEFORE our edit patches
  // store.dispatch — simulate that with a pre-edit reference.
  const middlewareDispatch = store.dispatch;
  const id = registry.register(store, { tier: 3 });

  registry.edit(id, ['n'], 999);
  assert.deepEqual(store.getState(), { n: 999 }, 'override active');

  middlewareDispatch({ type: 'set', state: { n: 2 } });
  assert.deepEqual(store.getState(), { n: 2 }, 'override cleared by real state change');
});

test('ephemeral override survives its own notify but respects later edits', () => {
  const registry = createStoreRegistry(() => {}, () => true);
  const store = makeStore({ n: 1 });
  const id = registry.register(store, { tier: 3 });
  registry.edit(id, ['n'], 10);
  registry.edit(id, ['n'], 20);
  assert.deepEqual(store.getState(), { n: 20 });
});

test('registering while a panel is active pushes the initial state', () => {
  const sent = [];
  const registry = createStoreRegistry((m) => sent.push(m), () => true);
  registry.register(makeStore({ hello: 1 }), { tier: 3 });
  const push = sent.filter((m) => m.type === 'store-state');
  assert.equal(push.length, 1);
  assert.deepEqual(push[0].state, { hello: 1 });
});

test('distinct instances sharing a prototype getState are NOT conflated', () => {
  class ProtoStore {
    constructor(s) {
      this._s = s;
      this._l = [];
    }
    getState() {
      return this._s;
    }
    dispatch(a) {
      for (const l of this._l) l();
      return a;
    }
    subscribe(l) {
      this._l.push(l);
      return () => {};
    }
  }
  const registry = createStoreRegistry(() => {}, () => false);
  const a = registry.register(new ProtoStore({ a: 1 }), { tier: 2 });
  const b = registry.register(new ProtoStore({ b: 2 }), { tier: 2 });
  assert.notEqual(a, b);
  assert.equal(registry.list().length, 2);
});

test('edit on an unknown store id throws', () => {
  const registry = createStoreRegistry(() => {}, () => true);
  assert.throws(() => registry.edit('42', [], {}), /Unknown store/);
});

test('state pushes only happen while a panel is connected', () => {
  const sent = [];
  let active = false;
  const registry = createStoreRegistry((m) => sent.push(m), () => active);
  const store = makeStore({ n: 1 });
  registry.register(store, { tier: 3 });
  registry.pushAll();
  assert.equal(sent.filter((m) => m.type === 'store-state').length, 0);
  active = true;
  registry.pushAll();
  assert.equal(sent.filter((m) => m.type === 'store-state').length, 1);
});
