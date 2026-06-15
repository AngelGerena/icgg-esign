import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/app.css'

import Dashboard from './pages/Dashboard.jsx'
import Upload from './pages/Upload.jsx'
import SignerPage from './pages/SignerPage.jsx'
import Shell from './components/Shell.jsx'
import Login from './pages/Login.jsx'
import { supabaseConfigured } from './lib/supabase.js'

// Simple error boundary so any runtime render error shows a readable message
// instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <Fallback
          title="Something went wrong"
          message={String(this.state.error?.message || this.state.error)}
        />
      )
    }
    return this.props.children
  }
}

function Fallback({ title, message }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        background: '#0f1320',
        color: '#f5f5f5',
      }}
    >
      <div style={{ maxWidth: 520, lineHeight: 1.5 }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p style={{ opacity: 0.85 }}>{message}</p>
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
const root = createRoot(rootEl)

if (!supabaseConfigured) {
  // Missing env vars: render a clear instruction instead of a blank page.
  root.render(
    <Fallback
      title="Configuration needed"
      message={
        'The app is missing its Supabase credentials. In Netlify go to ' +
        'Site settings → Environment variables and add VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_ANON_KEY, then trigger a redeploy (Deploys → Trigger deploy → Clear cache and deploy site).'
      }
    />,
  )
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            {/* Public signer route - no auth, no shell */}
            <Route path="/sign/:token" element={<SignerPage />} />
            <Route path="/login" element={<Login />} />
            {/* Authenticated app */}
            <Route element={<Shell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<Upload />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
