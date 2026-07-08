// Demo app shared by index.html (plain) and agent-test.html (agent preloaded).
(function () {
  const { createStore, applyMiddleware, compose } = Redux;
  const e = React.createElement;

  // --- Store 1: counter, created via the devtools compose shim (tier 1) ---
  const counterReducer = (state = { count: 0, step: 1, meta: { label: 'demo counter' } }, action) => {
    switch (action.type) {
      case 'increment': return { ...state, count: state.count + state.step };
      case 'decrement': return { ...state, count: state.count - state.step };
      case 'setStep': return { ...state, step: action.step };
      default: return state;
    }
  };
  const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
  const counterStore = createStore(counterReducer, composeEnhancers(applyMiddleware()));

  // --- Store 2: todos, only reachable via its Provider (tier 3) ---
  const todosReducer = (state = { items: ['learn redux', 'inspect state'], filter: 'all' }, action) => {
    switch (action.type) {
      case 'add': return { ...state, items: [...state.items, action.text] };
      case 'setFilter': return { ...state, filter: action.filter };
      default: return state;
    }
  };
  const todoStore = createStore(todosReducer);

  // --- Components ---
  class ClassCounter extends React.Component {
    constructor(props) {
      super(props);
      this.state = { clicks: 0, theme: { color: 'blue', size: 'medium' } };
    }
    render() {
      return e('section', { id: 'class-counter' },
        e('h2', null, 'ClassCounter (class component, local state)'),
        e('p', null, `Local clicks: ${this.state.clicks} — theme: ${this.state.theme.color}`),
        e('button', { onClick: () => this.setState({ clicks: this.state.clicks + 1 }) }, 'Click me')
      );
    }
  }

  function HookCounter({ label }) {
    const [value, setValue] = React.useState(10);
    const doubled = React.useMemo(() => value * 2, [value]);
    const count = ReactRedux.useSelector((s) => s.count);
    const dispatch = ReactRedux.useDispatch();
    return e('section', { id: 'hook-counter' },
      e('h2', null, `HookCounter (${label})`),
      e('p', null, `Redux count: ${count} — local value: ${value} (doubled: ${doubled})`),
      e('button', { onClick: () => dispatch({ type: 'increment' }) }, 'Redux +'),
      e('button', { onClick: () => dispatch({ type: 'decrement' }) }, 'Redux −'),
      e('button', { onClick: () => setValue(value + 1) }, 'Local +')
    );
  }

  function TodoList() {
    const todos = ReactRedux.useSelector((s) => s.items);
    const dispatch = ReactRedux.useDispatch();
    return e('section', { id: 'todo-list' },
      e('h2', null, 'TodoList (second store via Provider)'),
      e('ul', null, todos.map((t, i) => e('li', { key: i }, t))),
      e('button', { onClick: () => dispatch({ type: 'add', text: 'todo #' + (todos.length + 1) }) }, 'Add todo')
    );
  }

  function App() {
    return e(React.Fragment, null,
      e(ClassCounter),
      e(ReactRedux.Provider, { store: counterStore }, e(HookCounter, { label: 'hooks + react-redux' })),
      e(ReactRedux.Provider, { store: todoStore }, e(TodoList))
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(e(App));
})();
