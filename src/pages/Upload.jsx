import React, { useState, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase, FUNCTIONS_BASE } from '../lib/supabase.js'
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.min.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs'

const CAT_LABELS = {
  membership: 'Membership', baptism: 'Baptism', child_dedication: 'Child dedication',
  covering: 'Covering', volunteer: 'Volunteer', financial: 'Financial', other: 'Other',
}
const FIELD_TYPES = [
  { t: 'signature', l: 'Signature' }, { t: 'initials', l: 'Initials' },
  { t: 'text', l: 'Text' }, { t: 'date', l: 'Date' }, { t: 'checkbox', l: 'Checkbox' },
]

export default function Upload() {
  const { activeOrg } = useOutletContext()
  const fileRef = useRef(null)
  const pageRef = useRef(null)
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [pdfUrl, setPdfUrl] = useState('')
  const [ai, setAi] = useState(null)
  const [meta, setMeta] = useState({ category: 'other', ministry: 'General', title: '' })
  const [fields, setFields] = useState([])
  const [placing, setPlacing] = useState('signature')
  const [send, setSend] = useState({ name: '', email: '', pin: '', lang: 'es', reminder: 3 })
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('')

  async function onPick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setBusy(true); setBusyMsg('Reading document...')
    setPdfUrl(URL.createObjectURL(f))

    // extract text for AI categorization
    let text = ''
    try {
      const buf = await f.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const n = Math.min(pdf.numPages, 3)
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i)
        const tc = await page.getTextContent()
        text += tc.items.map((it) => it.str).join(' ') + '\n'
      }
    } catch { /* image-only PDF; AI will fall back */ }

    setBusyMsg('Categorizing with AI...')
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/categorize-document`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentText: text, fileName: f.name }),
      })
      const data = await r.json()
      setAi(data)
      setMeta({
        category: data.category || 'other',
        ministry: data.suggested_ministry || 'General',
        title: data.title || f.name.replace(/\.[^.]+$/, ''),
      })
    } catch {
      setMeta({ category: 'other', ministry: 'General', title: f.name.replace(/\.[^.]+$/, '') })
    }
    setBusy(false)
    setStep(2)
  }

  function placeField(e) {
    const rect = pageRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setFields([...fields, {
      tmp: Date.now(), field_type: placing,
      label: FIELD_TYPES.find((f) => f.t === placing).l,
      page: 1, x, y, width: 0.34, height: 0.05, required: placing === 'signature',
    }])
  }

  function toggleReq(i) {
    const c = [...fields]; c[i].required = !c[i].required; setFields(c)
  }
  function removeField(i) { setFields(fields.filter((_, idx) => idx !== i)) }

  async function finish() {
    if (!send.name || !send.email) { alert('Recipient name and email are required.'); return }
    setBusy(true); setBusyMsg('Saving document...')
    try {
      // 1. upload source PDF
      const path = `${activeOrg}/${meta.category}/_source/${Date.now()}_${file.name}`
      const up = await supabase.storage.from('documents').upload(path, file, { contentType: 'application/pdf', upsert: true })
      if (up.error) throw up.error

      // 2. hash PIN if present
      let pinHash = null
      if (send.pin) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(send.pin))
        pinHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
      }

      const { data: user } = await supabase.auth.getUser()
      // 3. create document
      const { data: doc, error } = await supabase.from('documents').insert({
        org_id: activeOrg, category: meta.category, title: meta.title,
        signer_name: send.name, signer_email: send.email,
        access_pin_hash: pinHash, lang: send.lang, reminder_days: Number(send.reminder),
        source_pdf_url: `documents/${path}`, created_by: user?.user?.id, status: 'draft',
      }).select().single()
      if (error) throw error

      // 4. insert fields
      if (fields.length) {
        await supabase.from('document_fields').insert(
          fields.map((f) => ({
            document_id: doc.id, field_type: f.field_type, label: f.label, page: f.page,
            x: f.x, y: f.y, width: f.width, height: f.height, required: f.required,
          })),
        )
      }
      await supabase.from('audit_events').insert({ document_id: doc.id, event_type: 'created', actor: `secretary:${user?.user?.id}` })

      // 5. send via edge function
      setBusyMsg('Sending email...')
      const { data: sess } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_BASE}/send-document`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session.access_token}` },
        body: JSON.stringify({ documentId: doc.id }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.detail || res.error || 'send failed')

      setBusy(false)
      alert(`Sent to ${send.email}. PIN: ${send.pin || '(none)'} — share this separately.`)
      window.location.href = '/'
    } catch (err) {
      setBusy(false)
      alert('Error: ' + (err.message || err))
    }
  }

  return (
    <div>
      <div className="eyebrow">Nuevo documento</div>
      <h1 style={{ marginBottom: 24 }}>Upload & categorize</h1>

      {busy && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--gold)' }}>
          <span style={{ fontWeight: 600 }}>{busyMsg}</span>
        </div>
      )}

      {step === 1 && (
        <div className="dropzone" onClick={() => fileRef.current.click()}>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={onPick} />
          <h3 style={{ marginBottom: 6 }}>Drop a PDF or click to choose</h3>
          <p className="muted" style={{ margin: 0 }}>The system reads it and suggests a category automatically.</p>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ marginBottom: 18 }}>
          {ai && (
            <div style={{ background: 'var(--info-bg)', color: 'var(--info)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: 14 }}>
              AI suggests: <strong>{CAT_LABELS[ai.category]}</strong>
              {ai.confidence ? ` · ${Math.round(ai.confidence * 100)}% confidence` : ''} · ministry: <strong>{ai.suggested_ministry || 'General'}</strong>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
            <div><label>Title</label><input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
            <div><label>Category</label>
              <select value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>
                {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <button className="gold" onClick={() => setStep(3)}>Continue to place fields</button>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 13 }}>Click a type, then click the page to drop it:</span>
            {FIELD_TYPES.map((f) => (
              <button key={f.t} className={placing === f.t ? '' : 'ghost'} style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setPlacing(f.t)}>{f.l}</button>
            ))}
          </div>
          <div style={{ background: 'var(--paper-card)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 18, display: 'flex', justifyContent: 'center' }}>
            <div ref={pageRef} onClick={placeField}
              style={{ position: 'relative', width: 480, height: 620, background: '#fff', border: '1px solid var(--line)', cursor: 'crosshair' }}>
              <iframe src={pdfUrl + '#toolbar=0&navpanes=0'} title="doc" style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} />
              {fields.map((f, i) => (
                <div key={f.tmp} onClick={(e) => { e.stopPropagation() }}
                  style={{
                    position: 'absolute', left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                    width: `${f.width * 100}%`, height: `${f.height * 100}%`,
                    background: f.field_type === 'signature' ? 'rgba(216,90,48,0.14)' : 'rgba(44,74,124,0.12)',
                    border: `1.5px solid ${f.field_type === 'signature' ? '#D85A30' : '#2C4A7C'}`,
                    borderRadius: 4, fontSize: 10, padding: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  }}>
                  <span style={{ fontWeight: 600 }}>{f.label}{f.required ? ' *' : ''}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button className="ghost" style={{ padding: '0 5px', fontSize: 9, borderRadius: 3 }} onClick={(e) => { e.stopPropagation(); toggleReq(i) }}>{f.required ? 'req' : 'opt'}</button>
                    <button className="ghost" style={{ padding: '0 5px', fontSize: 9, borderRadius: 3 }} onClick={(e) => { e.stopPropagation(); removeField(i) }}>x</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{fields.length} field(s) placed · required fields will block submission until filled.</p>
          <button className="gold" style={{ marginTop: 6 }} onClick={() => setStep(4)}>Continue to send</button>
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Send for signature</h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
            <div><label>Recipient name</label><input value={send.name} onChange={(e) => setSend({ ...send, name: e.target.value })} /></div>
            <div><label>Email</label><input value={send.email} onChange={(e) => setSend({ ...send, email: e.target.value })} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 18 }}>
            <div><label>Access PIN (sent separately)</label><input value={send.pin} onChange={(e) => setSend({ ...send, pin: e.target.value })} placeholder="optional" /></div>
            <div><label>Language</label>
              <select value={send.lang} onChange={(e) => setSend({ ...send, lang: e.target.value })}><option value="es">Español</option><option value="en">English</option></select>
            </div>
            <div><label>Reminder (days)</label>
              <select value={send.reminder} onChange={(e) => setSend({ ...send, reminder: e.target.value })}><option value="3">3</option><option value="5">5</option><option value="7">7</option><option value="0">None</option></select>
            </div>
          </div>
          <button className="gold" onClick={finish} disabled={busy}>Send document</button>
        </div>
      )}
    </div>
  )
}
