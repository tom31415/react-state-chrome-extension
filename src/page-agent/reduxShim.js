// Shims window.__REDUX_DEVTOOLS_EXTENSION__ / __REDUX_DEVTOOLS_EXTENSION_COMPOSE__
// at document_start. Any store created through them registers with us (tier 1)
// and gets its reducer wrapped to honor the OVERRIDE_ACTION, which makes live
// state edits persistent. Chains to the real Redux DevTools if present.

export const OVERRIDE_ACTION = '@@RRI/OVERRIDE_STATE';

export function wrapReducer(reducer) {
  return (state, action) =>
    action && action.type === OVERRIDE_ACTION ? action.state : reducer(state, action);
}

export function createInspectorEnhancer(register) {
  return (createStore) => (reducer, preloadedState) => {
    const store = createStore(wrapReducer(reducer), preloadedState);
    const originalReplaceReducer = store.replaceReducer.bind(store);
    store.replaceReducer = (next) => originalReplaceReducer(wrapReducer(next));
    register(store);
    return store;
  };
}

const compose = (...fns) => (x) => fns.reduceRight((acc, f) => f(acc), x);

export function installReduxShim(register, win = window) {
  const enhancer = createInspectorEnhancer(register);

  const prev = win.__REDUX_DEVTOOLS_EXTENSION__;
  const ext = (options) => {
    if (typeof prev === 'function') {
      const prevEnhancer = prev(options);
      return (createStore) => enhancer(prevEnhancer(createStore));
    }
    return enhancer;
  };
  if (prev && typeof prev === 'function') {
    for (const key of Object.keys(prev)) {
      const v = prev[key];
      ext[key] = typeof v === 'function' ? v.bind(prev) : v;
    }
  } else {
    // Libraries like zustand's devtools middleware call connect() directly;
    // give them inert stubs so pages keep working.
    ext.connect = () => ({
      init() {},
      send() {},
      subscribe() {
        return () => {};
      },
      unsubscribe() {},
      error() {},
    });
    ext.disconnect = () => {};
    ext.send = () => {};
    ext.listen = () => {};
    ext.notifyErrors = () => {};
  }
  win.__REDUX_DEVTOOLS_EXTENSION__ = ext;

  win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = (...args) => {
    if (args.length === 0) return ext();
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const options = args[0];
      return (...fns) => compose(...fns, ext(options));
    }
    return compose(...args, ext());
  };

  return ext;
}
