import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <Toaster
      position="top-center"
      gutter={8}
      toastOptions={{
        duration: 3000,
        style: {
          background: '#ffffff',
          color: '#1a1a1a',
          border: '1px solid #e8e8e8',
          borderRadius: '10px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
          fontSize: '13px',
          padding: '10px 14px',
          maxWidth: '360px',
        },
        success: { iconTheme: { primary: '#1a1a1a', secondary: '#ffffff' } },
        error: { iconTheme: { primary: '#b91c1c', secondary: '#ffffff' } },
      }}
    />
  </React.StrictMode>,
)