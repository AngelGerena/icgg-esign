import React, { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Shell() {
  const nav = useNavigate()
  const [session, setSession] = useState(undefined)
  const [orgs, setOrgs] = useState([])
  const [activeOrg, setActiveOrg] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('organizations')
      .select('id, name, type, parent_org_id')
      .is('parent_org_id', null)
      .then(({ data }) => {
        setOrgs(data || [])
        if (data?.length) setActiveOrg(data[0].id)
      })
  }, [session])

  if (session === undefined) return null
  if (session === null) { nav('/login'); return null }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Documentos<small>Finesse OS · ICGG</small></div>
        <div style={{ margin: '22px 0 18px' }}>
          <select
            value={activeOrg}
            onChange={(e) => setActiveOrg(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--paper)', border: '1px solid rgba(255,255,255,0.18)' }}
          >
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>Dashboard</NavLink>
          <NavLink to="/upload" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>Upload & categorize</NavLink>
        </nav>
        <div style={{ position: 'absolute', bottom: 22, fontSize: 12, opacity: 0.7 }}>
          <span className="nav-item" onClick={() => supabase.auth.signOut()}>Sign out</span>
        </div>
      </aside>
      <main className="main">
        <Outlet context={{ activeOrg, orgs }} />
      </main>
    </div>
  )
}
