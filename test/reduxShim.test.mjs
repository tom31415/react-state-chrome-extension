import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installReduxShim,
  createInspectorEnhancer,
  wrapReducer,
  OVERRIDE_ACTION,
} from '../src/page-agent/reduxShim.js';

// Minimal but faithful createStore, matching Redux's enhancer contract.
function createStore(reducer, preloadedState, enhancer) {
  if (typeof preloadedState === 'function' && enhancer === undefined) {
    enhancer = preloadedState;
    preloadedState = undefined;
  }
  if (enhancer) return enhancer(createStore)(reducer, preloadedState);
  let state = preloadedState;
  let currentReducer = reducer;
  const listeners = [];
  const store = {
    getState: () => state,
    dispatch(action) {
      state = currentReducer(state, action);
      for (const l of listeners) l();
      return action;
    },
    subscribe(l) {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
    replaceReducer(next) {
      currentReducer = next;
      store.dispatch({ type: '@@redux/REPLACE' });
    },
  };
  store.dispatch({ type: '@@redux/INIT' });
  return store;
}

const counter = (state = { count: 0 }, action) =>
  action.type === 'inc' ? { count: state.count + 1 } : state;

test('wrapReducer honors the override action and delegates otherwise', () => {
  const r = wrapReducer(counter);
  assert.deepEqual(r({ count: 1 }, { type: 'inc' }), { count: 2 });
  assert.deepEqual(r({ count: 1 }, { type: OVERRIDE_ACTION, state: { count: 99 } }), { count: 99 });
});

test('enhancer registers the store and overrides persist across later actions', () => {
  const registered = [];
  const enhancer = createInspectorEnhancer((s) => registered.push(s));
  const store = createStore(counter, enhancer);
  assert.equal(registered.length, 1);
  assert.equal(registered[0], store);

  store.dispatch({ type: 'inc' });
  assert.deepEqual(store.getState(), { count: 1 });

  store.dispatch({ type: OVERRIDE_ACTION, state: { count: 50 } });
  assert.deepEqual(store.getState(), { count: 50 });

  // Persistent: the next real action reduces FROM the override.
  store.dispatch({ type: 'inc' });
  assert.deepEqual(store.getState(), { count: 51 });
});

test('replaceReducer keeps the override wrapper', () => {
  const enhancer = createInspectorEnhancer(() => {});
  const store = createStore(counter, enhancer);
  store.replaceReducer(counter);
  store.dispatch({ type: OVERRIDE_ACTION, state: { count: 7 } });
  assert.deepEqual(store.getState(), { count: 7 });
});

test('shim installs a devtools-compatible compose on a fresh window', () => {
  const win = {};
  const registered = [];
  installReduxShim((s) => registered.push(s), win);

  assert.equal(typeof win.__REDUX_DEVTOOLS_EXTENSION__, 'function');
  assert.equal(typeof win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__, 'function');
  assert.equal(typeof win.__REDUX_DEVTOOLS_EXTENSION__.connect, 'function');

  // Typical app code: composeEnhancers(applyMiddleware(...)) with a no-op enhancer.
  const passthrough = (next) => (...args) => next(...args);
  const composed = win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__(passthrough);
  const store = createStore(counter, composed);
  assert.equal(registered.length, 1);
  store.dispatch({ type: OVERRIDE_ACTION, state: { count: 3 } });
  assert.deepEqual(store.getState(), { count: 3 });
});

test('shim compose called with options object still works', () => {
  const win = {};
  const registered = [];
  installReduxShim((s) => registered.push(s), win);
  const composeEnhancers = win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'demo' });
  const store = createStore(counter, composeEnhancers());
  assert.equal(registered.length, 1);
  assert.deepEqual(store.getState(), { count: 0 });
});

test('shim chains to a pre-existing devtools extension', () => {
  const prevCalls = [];
  const win = {
    __REDUX_DEVTOOLS_EXTENSION__: (options) => {
      prevCalls.push(options);
      return (next) => (...args) => next(...args);
    },
  };
  const registered = [];
  installReduxShim((s) => registered.push(s), win);
  const store = createStore(counter, win.__REDUX_DEVTOOLS_EXTENSION__({ name: 'x' }));
  assert.equal(prevCalls.length, 1);
  assert.equal(registered.length, 1);
  store.dispatch({ type: OVERRIDE_ACTION, state: { count: 8 } });
  assert.deepEqual(store.getState(), { count: 8 });
});
