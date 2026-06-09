import React, { useEffect, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const CAT_LABELS = {
  membership: 'Membership', baptism: 'Baptism', child_dedication: 'Child dedication',
  covering: 'Covering', volunteer: 'Volunteer', financial: 'Financial', other: 'Other',
}

export default function Dashboard() {
  const { activeOrg } = useOutletContext()
  const [docs, setDocs] = useState([])
  const [filter, setFilter] = useState({ cat: 'all', q: '' })

  useEffect(() => {
    if (!activeOrg) return
    supabase
      .from('documents')
      .select('id, title, category, status, signer_name, created_at, signed_at, signed_pdf_url')
      .eq('org_id', activeOrg)
      .order('created_at', { ascending: false })
      .then(({ data }) => setDocs(data || []))
  }, [activeOrg])

  const stats = {
    awaiting: docs.filter((d) => ['sent', 'delivered', 'viewed'].includes(d.status)).length,
    signed: docs.filter((d) => d.status === 'signed').length,
    total: docs.length,
  }

  const filtered = docs.filter((d) => {
    if (filter.cat !== 'all' && d.category !== filter.cat) return false
    if (filter.q && !d.signer_name.toLowerCase().includes(filter.q.toLowerCase())) return false
    return true
  })

  function badgeClass(s) {
    if (s === 'signed') return 'badge signed'
    if (s === 'viewed') return 'badge viewed'
    if (s === 'draft') return 'badge draft'
    return 'badge awaiting'
  }

  async function openSigned(d) {
    if (!d.signed_pdf_url) return
    const path = d.signed_pdf_url.replace(/^documents\//, '')
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div>
      <div className="eyebrow">Panel</div>
      <h1 style={{ marginBottom: 24 }}>Dashboard</h1>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: 28 }}>
        <div className="stat"><div className="n">{stats.awaiting}</div><div className="l">Awaiting signature</div></div>
        <div className="stat"><div className="n">{stats.signed}</div><div className="l">Signed & stored</div></div>
        <div className="stat"><div className="n">{stats.total}</div><div className="l">All documents</div></div>
        <Link to="/upload" className="stat" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="n" style={{ color: 'var(--gold)' }}>+</div><div className="l">Upload a document</div>
        </Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 2fr', marginBottom: 14 }}>
        <select value={filter.cat} onChange={(e) => setFilter({ ...filter, cat: e.target.value })}>
          <option value="all">All categories</option>
          {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div />
        <input placeholder="Search signer name..." value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 && <div style={{ padding: 28, textAlign: 'center' }} className="muted">No documents yet. Upload one to begin.</div>}
        {filtered.map((d) => (
          <div className="row" key={d.id}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{d.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{CAT_LABELS[d.category]} · {d.signer_name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className={badgeClass(d.status)}>{d.status}</span>
              {d.status === 'signed' && (
                <button className="ghost sm" onClick={() => openSigned(d)}>View / print</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
