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

  const ThemeContext = React.createContext('light');

  // staleTime: 0 (react-query's default) marks data stale the instant it
  // resolves, so the panel's "fresh" badge would never actually be
  // observable — a brief real window matches how apps normally tune this.
  const queryClient = new ReactQuery.QueryClient({
    defaultOptions: { queries: { staleTime: 30000 } },
  });

  function fakeFetchUser(id) {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ id, name: id === '1' ? 'Ada Lovelace' : 'Grace Hopper' }), 150);
    });
  }

  function UserQuery() {
    const [userId, setUserId] = React.useState('1');
    const query = ReactQuery.useQuery({
      queryKey: ['user', userId],
      queryFn: () => fakeFetchUser(userId),
    });
    return e('section', { id: 'user-query' },
      e('h2', null, 'UserQuery (React Query)'),
      e('p', null, `status: ${query.status} — ${query.data ? query.data.name : '(no data yet)'}`),
      e('button', { onClick: () => setUserId(userId === '1' ? '2' : '1') }, 'Switch user')
    );
  }

  function AddCommentMutation() {
    const mutation = ReactQuery.useMutation({
      mutationFn: (text) => new Promise((resolve) => setTimeout(() => resolve({ text }), 100)),
    });
    return e('section', { id: 'comment-mutation' },
      e('h2', null, 'AddCommentMutation (React Query)'),
      e('p', null, `status: ${mutation.status}`),
      e('button', { onClick: () => mutation.mutate('a demo comment') }, 'Submit comment')
    );
  }

  // --- Components ---
  class ClassCounter extends React.Component {
    constructor(props) {
      super(props);
      this.state = { clicks: 0, theme: { color: 'blue', size: 'medium' } };
    }
    render() {
      return e('section', { id: 'class-counter' },
        e('h2', null, `ClassCounter (${this.props.label})`),
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

  function ThemedBadge() {
    const theme = React.useContext(ThemeContext);
    return e('span', { id: 'themed-badge' }, `theme: ${theme}`);
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
      e(ClassCounter, { label: 'class component, local state' }),
      e(ReactRedux.Provider, { store: counterStore }, e(HookCounter, { label: 'hooks + react-redux' })),
      e(ReactRedux.Provider, { store: todoStore }, e(TodoList)),
      e(ThemeContext.Provider, { value: 'dark' }, e(ThemedBadge)),
      e(ReactQuery.QueryClientProvider, { client: queryClient },
        e(React.Fragment, null, e(UserQuery), e(AddCommentMutation))
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(e(App));
})();
