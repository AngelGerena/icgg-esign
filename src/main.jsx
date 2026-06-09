import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/app.css'

import Dashboard from './pages/Dashboard.jsx'
import Upload from './pages/Upload.jsx'
import SignerPage from './pages/SignerPage.jsx'
import Shell from './components/Shell.jsx'
import Login from './pages/Login.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
