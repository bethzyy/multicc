import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/shared/ToastContext'
import { ToastContainer } from './components/shared/ToastContainer'
import './styles/main.css'
import './styles/variables.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
    <ToastContainer />
  </ToastProvider>
)
