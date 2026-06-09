import React, { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')

  async function signIn() {
    setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setMsg(error.message)
    else nav('/')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: 360 }}>
        <div className="eyebrow">Finesse OS</div>
        <h2 style={{ marginTop: 6, marginBottom: 18 }}>ICGG Documentos</h2>
        <label>Correo / Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 12 }} />
        <label>Contraseña / Password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginBottom: 16 }} />
        <button className="gold" style={{ width: '100%' }} onClick={signIn}>Entrar / Sign in</button>
        {msg && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  )
}
