/**
 * TerminalContext - Centralized terminal state management
 *
 * Uses useReducer + separated State/Dispatch contexts to avoid
 * unnecessary re-renders when only state or dispatch is needed.
 *
 * Pattern from muxvo: useTerminalState() and useTerminalActions()
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';

// ── State Shape ──

const MAX_TERMINALS = 20;

export interface TerminalEntry {
  id: string;
  state: string;
  cwd: string;
  customName?: string;
}

export interface CloseConfirmState {
  open: boolean;
  terminalId: string;
  processName: string;
}

export interface TerminalState {
  terminals: TerminalEntry[];
  terminalOrder: string[];
  viewMode: 'Tiling' | 'Focused';
  focusedId: string | null;
  selectedId: string | null;
  activeSidebarId: string | null;
  terminalNames: Record<string, string>;
  closeConfirm: CloseConfirmState;
}

export const initialTerminalState: TerminalState = {
  terminals: [],
  terminalOrder: [],
  viewMode: 'Tiling',
  focusedId: null,
  selectedId: null,
  activeSidebarId: null,
  terminalNames: {},
  closeConfirm: { open: false, terminalId: '', processName: '' },
};

// ── Actions ──

type TerminalAction =
  | { type: 'SET_TERMINALS'; entries: TerminalEntry[] }
  | { type: 'ADD_TERMINAL'; entry: TerminalEntry }
  | { type: 'REMOVE_TERMINAL'; id: string }
  | { type: 'UPDATE_STATE'; id: string; state: string }
  | { type: 'UPDATE_CWD'; id: string; cwd: string }
  | { type: 'RENAME'; id: string; name: string }
  | { type: 'REORDER'; newOrder: string[] }
  | { type: 'SET_VIEW_MODE'; mode: 'Tiling' | 'Focused' }
  | { type: 'SET_FOCUSED'; id: string | null }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'SET_ACTIVE_SIDEBAR'; id: string | null }
  | { type: 'OPEN_CLOSE_CONFIRM'; terminalId: string; processName: string }
  | { type: 'CLOSE_CLOSE_CONFIRM' };

// ── Reducer ──

export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'SET_TERMINALS':
      return {
        ...state,
        terminals: action.entries,
        terminalOrder: action.entries.map((e) => e.id),
      };

    case 'ADD_TERMINAL':
      return {
        ...state,
        terminals: [...state.terminals, action.entry],
        terminalOrder: [...state.terminalOrder, action.entry.id],
      };

    case 'REMOVE_TERMINAL': {
      const names = { ...state.terminalNames };
      delete names[action.id];
      return {
        ...state,
        terminals: state.terminals.filter((t) => t.id !== action.id),
        terminalOrder: state.terminalOrder.filter((id) => id !== action.id),
        terminalNames: names,
        focusedId: state.focusedId === action.id ? null : state.focusedId,
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        viewMode: state.focusedId === action.id ? 'Tiling' : state.viewMode,
      };
    }

    case 'UPDATE_STATE': {
      const target = state.terminals.find((t) => t.id === action.id);
      if (target && target.state === action.state) return state; // Same state — skip re-render
      return {
        ...state,
        terminals: state.terminals.map((t) =>
          t.id === action.id ? { ...t, state: action.state } : t
        ),
      };
    }

    case 'UPDATE_CWD':
      return {
        ...state,
        terminals: state.terminals.map((t) =>
          t.id === action.id ? { ...t, cwd: action.cwd } : t
        ),
      };

    case 'RENAME': {
      const names = { ...state.terminalNames };
      if (!action.name) {
        delete names[action.id];
      } else {
        names[action.id] = action.name;
      }
      return { ...state, terminalNames: names };
    }

    case 'REORDER':
      return { ...state, terminalOrder: action.newOrder };

    case 'SET_VIEW_MODE':
      return {
        ...state,
        viewMode: action.mode,
        activeSidebarId: action.mode === 'Tiling' ? null : state.activeSidebarId,
      };

    case 'SET_FOCUSED':
      return { ...state, focusedId: action.id, activeSidebarId: null };

    case 'SET_SELECTED':
      return { ...state, selectedId: action.id };

    case 'SET_ACTIVE_SIDEBAR':
      return { ...state, activeSidebarId: action.id };

    case 'OPEN_CLOSE_CONFIRM':
      return {
        ...state,
        closeConfirm: { open: true, terminalId: action.terminalId, processName: action.processName },
      };

    case 'CLOSE_CLOSE_CONFIRM':
      return {
        ...state,
        closeConfirm: { open: false, terminalId: '', processName: '' },
      };

    default:
      return state;
  }
}

// ── Contexts ──

const TerminalStateContext = createContext<TerminalState | null>(null);
const TerminalDispatchContext = createContext<Dispatch<TerminalAction> | null>(null);

// ── Provider ──

export function TerminalProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);

  // Clear focused state if the focused terminal is removed
  useEffect(() => {
    if (state.focusedId && !state.terminals.find((t) => t.id === state.focusedId)) {
      dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
      dispatch({ type: 'SET_FOCUSED', id: null });
    }
    if (state.selectedId && !state.terminals.find((t) => t.id === state.selectedId)) {
      dispatch({ type: 'SET_SELECTED', id: null });
    }
  }, [state.terminals, state.focusedId, state.selectedId]);

  // Esc key exits focused mode (only when focus is NOT inside a terminal)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && state.viewMode === 'Focused') {
        const active = document.activeElement;
        const isInTerminal = active?.closest('.xterm') !== null;
        if (!isInTerminal) {
          dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
          dispatch({ type: 'SET_FOCUSED', id: null });
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.viewMode]);

  return (
    <TerminalDispatchContext.Provider value={dispatch}>
      <TerminalStateContext.Provider value={state}>
        {children}
      </TerminalStateContext.Provider>
    </TerminalDispatchContext.Provider>
  );
}

// ── Hooks ──

export function useTerminalState(): TerminalState {
  const state = useContext(TerminalStateContext);
  if (!state) {
    throw new Error('useTerminalState must be used within a TerminalProvider');
  }
  return state;
}

export function useTerminalDispatch(): Dispatch<TerminalAction> {
  const dispatch = useContext(TerminalDispatchContext);
  if (!dispatch) {
    throw new Error('useTerminalDispatch must be used within a TerminalProvider');
  }
  return dispatch;
}

/** Derived data: ordered terminals with custom names merged */
export function useOrderedTerminals(): (TerminalEntry & { customName?: string })[] {
  const state = useTerminalState();
  return state.terminalOrder.length > 0
    ? state.terminalOrder
        .map((id) => state.terminals.find((t) => t.id === id))
        .filter((t): t is TerminalEntry => t !== undefined)
        .map((t) => ({ ...t, customName: state.terminalNames[t.id] }))
    : state.terminals.map((t) => ({ ...t, customName: state.terminalNames[t.id] }));
}

/** Async terminal actions that combine IPC calls with dispatch */
export function useTerminalActions() {
  const dispatch = useTerminalDispatch();
  const stateRef = useRef<TerminalState>(initialTerminalState);
  const state = useTerminalState();
  stateRef.current = state;

  const addTerminal = useCallback(async (cwd: string): Promise<string | null> => {
    if (stateRef.current.terminals.length >= MAX_TERMINALS) {
      return null;
    }
    const id = crypto.randomUUID();
    dispatch({ type: 'ADD_TERMINAL', entry: { id, state: 'Created', cwd } });
    return id;
  }, [dispatch]);

  const removeTerminal = useCallback(async (id: string): Promise<void> => {
    dispatch({ type: 'REMOVE_TERMINAL', id });
  }, [dispatch]);

  const handleDoubleClick = useCallback((id: string): void => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Focused' });
    dispatch({ type: 'SET_FOCUSED', id });
  }, [dispatch]);

  const handleFocusTerminal = useCallback((id: string): void => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Focused' });
    dispatch({ type: 'SET_FOCUSED', id });
  }, [dispatch]);

  const handleBackToTiling = useCallback((): void => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
    dispatch({ type: 'SET_FOCUSED', id: null });
  }, [dispatch]);

  const handleSidebarClick = useCallback((id: string): void => {
    dispatch({ type: 'SET_FOCUSED', id });
  }, [dispatch]);

  const handleSidebarActivate = useCallback((id: string): void => {
    dispatch({ type: 'SET_ACTIVE_SIDEBAR', id });
  }, [dispatch]);

  const handleSidebarDeactivate = useCallback((): void => {
    dispatch({ type: 'SET_ACTIVE_SIDEBAR', id: null });
  }, [dispatch]);

  const handleTileClick = useCallback((id: string): void => {
    dispatch({ type: 'SET_SELECTED', id });
  }, [dispatch]);

  const handleReorder = useCallback((newOrder: string[]): void => {
    dispatch({ type: 'REORDER', newOrder });
  }, [dispatch]);

  const handleRename = useCallback((id: string, name: string): void => {
    dispatch({ type: 'RENAME', id, name });
  }, [dispatch]);

  const handleCloseConfirm = useCallback(async (): Promise<void> => {
    const { terminalId } = stateRef.current.closeConfirm;
    dispatch({ type: 'CLOSE_CLOSE_CONFIRM' });
    dispatch({ type: 'REMOVE_TERMINAL', id: terminalId });
  }, [dispatch]);

  const handleCloseCancel = useCallback((): void => {
    dispatch({ type: 'CLOSE_CLOSE_CONFIRM' });
  }, [dispatch]);

  return {
    addTerminal,
    removeTerminal,
    handleDoubleClick,
    handleFocusTerminal,
    handleBackToTiling,
    handleSidebarClick,
    handleSidebarActivate,
    handleSidebarDeactivate,
    handleTileClick,
    handleReorder,
    handleRename,
    handleCloseConfirm,
    handleCloseCancel,
    maxReached: state.terminals.length >= MAX_TERMINALS,
  };
}
