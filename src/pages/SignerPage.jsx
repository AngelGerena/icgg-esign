import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FUNCTIONS_BASE } from '../lib/supabase.js'
import SignatureCanvas from '../components/SignatureCanvas.jsx'

const T = {
  es: {
    loading: 'Cargando documento...', notFound: 'Documento no disponible.',
    pinTitle: 'Ingrese su PIN de acceso', pinHint: 'Se le envió por separado.',
    pinBtn: 'Continuar', pinBad: 'PIN incorrecto.',
    required: 'Este campo es obligatorio', submit: 'Enviar firma',
    submitBlocked: 'Complete los campos requeridos', sign: 'Firme aquí',
    clear: 'Borrar', done: '¡Gracias! Su documento ha sido firmado y enviado.',
    yes: 'Sí',
  },
  en: {
    loading: 'Loading document...', notFound: 'Document unavailable.',
    pinTitle: 'Enter your access PIN', pinHint: 'It was sent to you separately.',
    pinBtn: 'Continue', pinBad: 'Incorrect PIN.',
    required: 'This field is required', submit: 'Submit signature',
    submitBlocked: 'Complete required fields first', sign: 'Sign here',
    clear: 'Clear', done: 'Thank you! Your document has been signed and sent.',
    yes: 'Yes',
  },
}

export default function SignerPage() {
  const { token } = useParams()
  const [doc, setDoc] = useState(undefined)
  const [lang, setLang] = useState('es')
  const [values, setValues] = useState({})
  const [pin, setPin] = useState('')
  const [pinOk, setPinOk] = useState(false)
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  useEffect(() => {
    fetch(`${FUNCTIONS_BASE}/sign-document?token=${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setDoc(null); return }
        setDoc(d); setLang(d.lang || 'es')
        if (!d.requiresPin) setPinOk(true)
      })
      .catch(() => setDoc(null))
  }, [token])

  const t = T[lang]

  if (doc === undefined) return <Center>{t.loading}</Center>
  if (doc === null) return <Center>{T.es.notFound}</Center>
  if (done) return <Center><div style={{ textAlign: 'center' }}><div style={{ fontSize: 40 }}>✓</div><p>{t.done}</p></div></Center>

  const required = (doc.fields || []).filter((f) => f.required)
  const allFilled = required.every((f) => truthy(values[f.id]))

  function setVal(id, v) { setValues({ ...values, [id]: v }); setErrors({ ...errors, [id]: false }) }

  async function submit() {
    const errs = {}
    required.forEach((f) => { if (!truthy(values[f.id])) errs[f.id] = true })
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSubmitMsg('...')
    const r = await fetch(`${FUNCTIONS_BASE}/sign-document`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, pin, values }),
    })
    const res = await r.json()
    if (r.ok) setDone(true)
    else if (res.error === 'invalid_pin') { setPinOk(false); setSubmitMsg(t.pinBad) }
    else if (res.error === 'missing_required') { const e = {}; res.fields.forEach((id) => (e[id] = true)); setErrors(e); setSubmitMsg('') }
    else setSubmitMsg(res.error || 'Error')
  }

  // PIN gate
  if (!pinOk) {
    return (
      <Center>
        <div className="card" style={{ width: 320 }}>
          <div style={{ textAlign: 'right' }}><LangToggle lang={lang} setLang={setLang} /></div>
          <h3 style={{ marginBottom: 6 }}>{t.pinTitle}</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{t.pinHint}</p>
          <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 12 }} inputMode="numeric" />
          <button className="gold" style={{ width: '100%' }} onClick={() => setPinOk(true)} disabled={!pin}>{t.pinBtn}</button>
          {submitMsg === t.pinBad && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{t.pinBad}</p>}
        </div>
      </Center>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div className="eyebrow">Iglesia Cristiana Gracia y Gloria</div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <h1 style={{ marginBottom: 20 }}>{doc.title}</h1>

      {(doc.fields || []).map((f) => (
        <div key={f.id} style={{ marginBottom: 18 }}>
          <label>{f.label}{f.required ? ' *' : ''}</label>
          {f.field_type === 'signature' || f.field_type === 'initials' ? (
            <SignatureCanvas
              label={t.sign} clearLabel={t.clear}
              onChange={(dataUrl) => setVal(f.id, dataUrl)}
              error={errors[f.id]}
            />
          ) : f.field_type === 'checkbox' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!values[f.id]} onChange={(e) => setVal(f.id, e.target.checked)} /> {t.yes}
            </label>
          ) : (
            <input
              type={f.field_type === 'date' ? 'date' : 'text'}
              className={errors[f.id] ? 'error' : ''}
              value={values[f.id] || ''}
              onChange={(e) => setVal(f.id, e.target.value)}
            />
          )}
          {errors[f.id] && <p style={{ color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }}>{t.required}</p>}
        </div>
      ))}

      <button className="gold" style={{ width: '100%', marginTop: 8 }} onClick={submit} disabled={!allFilled}>
        {allFilled ? t.submit : t.submitBlocked}
      </button>
      {submitMsg && submitMsg !== '...' && <p style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'center' }}>{submitMsg}</p>}
    </div>
  )
}

function truthy(v) { return v !== undefined && v !== null && v !== '' && v !== false }
function Center({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>{children}</div>
}
function LangToggle({ lang, setLang }) {
  return (
    <button className="ghost sm" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>{lang === 'es' ? 'EN' : 'ES'}</button>
  )
}
