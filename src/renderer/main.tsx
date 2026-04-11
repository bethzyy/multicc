import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/shared/ToastContext'
import { ToastContainer } from './components/shared/ToastContainer'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import './styles/main.css'
import './styles/variables.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ToastProvider>
      <App />
      <ToastContainer />
    </ToastProvider>
  </ErrorBoundary>
)
