import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#1e1e1e',
          color: '#ccc',
          fontFamily: 'Consolas, "Courier New", monospace',
          padding: '2rem',
        }}>
          <h2 style={{ color: '#f44336', marginBottom: '1rem' }}>
            Something went wrong
          </h2>
          <pre style={{
            backgroundColor: '#2d2d2d',
            padding: '1rem',
            borderRadius: '4px',
            maxWidth: '80%',
            maxHeight: '40vh',
            overflow: 'auto',
            fontSize: '0.85rem',
            marginBottom: '1.5rem',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={this.handleReload}
            style={{
              padding: '0.5rem 1.5rem',
              backgroundColor: '#0d7377',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
