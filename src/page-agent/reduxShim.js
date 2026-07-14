// Shims window.__REDUX_DEVTOOLS_EXTENSION__ / __REDUX_DEVTOOLS_EXTENSION_COMPOSE__
// at document_start. Any store created through them registers with us (tier 1)
// and gets its reducer wrapped to honor the OVERRIDE_ACTION, which makes live
// state edits persistent.
//
// The real Redux DevTools extension also claims these globals at document_start
// and the load order is not guaranteed, so both are installed as accessor
// properties: if Redux DevTools assigns over us later, the setter captures its
// implementation and we chain to it — both tools keep working.

export const OVERRIDE_ACTION = '@@RSI/OVERRIDE_STATE';

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

  let chainedExt =
    typeof win.__REDUX_DEVTOOLS_EXTENSION__ === 'function'
      ? win.__REDUX_DEVTOOLS_EXTENSION__
      : null;
  let chainedComposeFactory =
    typeof win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ === 'function'
      ? win.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      : null;

  const ext = (options) => {
    if (chainedExt) {
      try {
        const theirEnhancer = chainedExt(options);
        if (typeof theirEnhancer === 'function') {
          return (createStore) => enhancer(theirEnhancer(createStore));
        }
      } catch {
        // a broken chained devtools must not take ours down
      }
    }
    return enhancer;
  };

  // Methods some libraries call directly (e.g. zustand devtools middleware):
  // delegate to the chained extension when one appears, otherwise inert stubs.
  const delegate = (method, fallback) => (...args) => {
    if (chainedExt && typeof chainedExt[method] === 'function') {
      return chainedExt[method](...args);
    }
    return fallback(...args);
  };
  ext.connect = delegate('connect', () => ({
    init() {},
    send() {},
    subscribe() {
      return () => {};
    },
    unsubscribe() {},
    error() {},
  }));
  ext.disconnect = delegate('disconnect', () => {});
  ext.send = delegate('send', () => {});
  ext.listen = delegate('listen', () => {});
  ext.notifyErrors = delegate('notifyErrors', () => {});
  ext.open = delegate('open', () => {});

  const buildCompose = (fns, options) => {
    if (chainedComposeFactory) {
      try {
        const theirCompose =
          options === undefined ? chainedComposeFactory() : chainedComposeFactory(options);
        if (typeof theirCompose === 'function') {
          // Their compose appends their enhancer; we append only our plain
          // enhancer to avoid chaining theirs twice.
          return theirCompose(...fns, enhancer);
        }
      } catch {
        // fall through to our own compose
      }
    }
    return compose(...fns, ext(options));
  };

  const composeFactory = (...args) => {
    if (args.length === 0) return (...fns) => buildCompose(fns, undefined);
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const options = args[0];
      return (...fns) => buildCompose(fns, options);
    }
    return buildCompose(args, undefined);
  };

  defineChaining(win, '__REDUX_DEVTOOLS_EXTENSION__', ext, (v) => {
    if (typeof v === 'function' && v !== ext) chainedExt = v;
  });
  defineChaining(win, '__REDUX_DEVTOOLS_EXTENSION_COMPOSE__', composeFactory, (v) => {
    if (typeof v === 'function' && v !== composeFactory) chainedComposeFactory = v;
  });

  return ext;
}

function defineChaining(win, name, value, onAssign) {
  try {
    Object.defineProperty(win, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: onAssign,
    });
  } catch {
    win[name] = value;
  }
}
