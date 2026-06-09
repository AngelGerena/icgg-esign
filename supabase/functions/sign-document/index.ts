// supabase/functions/sign-document/index.ts
// The ONLY entry point signers touch. No anon RLS access anywhere.
// GET  ?token=...                -> returns doc + fields for rendering (after PIN check on submit)
// POST {token, pin, values}      -> validates PIN, enforces required fields,
//                                   flattens signed PDF, stores it foldered by
//                                   signer name, flips status to 'signed',
//                                   notifies the secretary by email.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()

  try {
    // -------- GET: load the document for the signer to view --------
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const token = url.searchParams.get('token')
      if (!token) return json({ error: 'missing token' }, 400)

      const { data: doc } = await db
        .from('documents')
        .select('id, title, lang, status, signer_name, signing_token, expires_at, source_pdf_url, access_pin_hash')
        .eq('signing_token', token)
        .maybeSingle()
      if (!doc) return json({ error: 'not found' }, 404)
      if (['signed', 'voided', 'declined'].includes(doc.status))
        return json({ error: 'unavailable', status: doc.status }, 410)
      if (doc.expires_at && new Date(doc.expires_at) < new Date())
        return json({ error: 'expired' }, 410)

      const { data: fields } = await db
        .from('document_fields')
        .select('id, field_type, label, page, x, y, width, height, required, options')
        .eq('document_id', doc.id)

      // first open -> log + flip to delivered/viewed
      await db.from('audit_events').insert({
        document_id: doc.id,
        event_type: 'opened',
        actor: `signer:${doc.signer_name}`,
        ip_address: clientIp(req),
        user_agent: req.headers.get('user-agent'),
      })
      if (doc.status === 'sent' || doc.status === 'delivered')
        await db.from('documents').update({ status: 'viewed' }).eq('id', doc.id)

      // signed URL so the front end can render the source PDF
      const { data: signed } = await db.storage
        .from('documents')
        .createSignedUrl(stripBucket(doc.source_pdf_url), 600)

      return json({
        title: doc.title,
        lang: doc.lang,
        signerName: doc.signer_name,
        requiresPin: !!doc.access_pin_hash,
        pdfUrl: signed?.signedUrl,
        fields,
      })
    }

    // -------- POST: submit signed values --------
    const { token, pin, values } = await req.json()
    if (!token) return json({ error: 'missing token' }, 400)

    const { data: doc } = await db
      .from('documents')
      .select('*')
      .eq('signing_token', token)
      .maybeSingle()
    if (!doc) return json({ error: 'not found' }, 404)
    if (doc.status === 'signed') return json({ error: 'already signed' }, 410)

    // PIN check
    if (doc.access_pin_hash) {
      const ok = await verifyPin(pin || '', doc.access_pin_hash)
      if (!ok) return json({ error: 'invalid_pin' }, 403)
    }

    const { data: fields } = await db
      .from('document_fields')
      .select('*')
      .eq('document_id', doc.id)

    // enforce required fields server-side (front end also blocks, but never trust it)
    const missing = (fields || []).filter(
      (f: any) => f.required && !truthy(values?.[f.id]),
    )
    if (missing.length) {
      return json({ error: 'missing_required', fields: missing.map((f: any) => f.id) }, 422)
    }

    // ----- flatten the PDF -----
    const srcResp = await db.storage.from('documents').download(stripBucket(doc.source_pdf_url))
    if (srcResp.error) return json({ error: 'source pdf missing' }, 500)
    const srcBytes = new Uint8Array(await srcResp.data.arrayBuffer())

    const pdf = await PDFDocument.load(srcBytes)
    const helv = await pdf.embedFont(StandardFonts.Helvetica)
    const pages = pdf.getPages()

    for (const f of fields || []) {
      const page = pages[(f.page || 1) - 1]
      if (!page) continue
      const { width: pw, height: ph } = page.getSize()
      const px = f.x * pw
      const fieldH = f.height * ph
      // pdf-lib origin is bottom-left; our coords are top-left normalized
      const py = ph - f.y * ph - fieldH
      const val = values?.[f.id]

      if (f.field_type === 'signature' && typeof val === 'string' && val.startsWith('data:image')) {
        const pngBytes = decodeDataUrl(val)
        const img = await pdf.embedPng(pngBytes)
        const fieldW = f.width * pw
        page.drawImage(img, { x: px, y: py, width: fieldW, height: fieldH })
      } else if (f.field_type === 'checkbox') {
        page.drawText(truthy(val) ? 'X' : '', { x: px, y: py + 2, size: 12, font: helv, color: rgb(0.1, 0.15, 0.25) })
      } else if (val != null) {
        page.drawText(String(val), { x: px, y: py + 2, size: 11, font: helv, color: rgb(0.1, 0.15, 0.25) })
      }
    }

    // ----- certificate of completion page -----
    const cert = pdf.addPage()
    const { height: ch } = cert.getSize()
    let cy = ch - 60
    const line = (t: string, size = 11) => { cert.drawText(t, { x: 50, y: cy, size, font: helv, color: rgb(0.11, 0.15, 0.25) }); cy -= size + 8 }
    line('Certificate of Completion', 16); cy -= 8
    line(`Document: ${doc.title}`)
    line(`Signer: ${doc.signer_name} <${doc.signer_email}>`)
    line(`Signed at: ${new Date().toISOString()}`)
    line(`IP address: ${clientIp(req) || 'n/a'}`)
    line(`Document ID: ${doc.id}`)
    line(`Token: ${doc.signing_token}`)

    const outBytes = await pdf.save()

    // ----- store foldered by signer name -----
    const folder = `${doc.org_id}/${doc.category}/${slug(doc.signer_name)}`
    const path = `${folder}/${doc.id}.pdf`
    const up = await db.storage.from('documents').upload(path, outBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (up.error) return json({ error: 'store failed', detail: up.error.message }, 500)

    // ----- persist values + flip status (trigger activates covering if applicable) -----
    for (const f of fields || []) {
      await db.from('document_fields')
        .update({ value: stringifyVal(values?.[f.id]), filled_at: new Date().toISOString() })
        .eq('id', f.id)
    }
    await db.from('documents')
      .update({ status: 'signed', signed_pdf_url: `documents/${path}`, signed_at: new Date().toISOString() })
      .eq('id', doc.id)
    await db.from('audit_events').insert({
      document_id: doc.id,
      event_type: 'signed',
      actor: `signer:${doc.signer_email}`,
      ip_address: clientIp(req),
      user_agent: req.headers.get('user-agent'),
    })

    // ----- notify the secretary -----
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey && doc.created_by) {
      const { data: creator } = await db.auth.admin.getUserById(doc.created_by)
      const to = creator?.user?.email
      if (to) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'ICGG Documentos <documentos@finessemedia.pro>',
            to: [to],
            subject: `Signed: ${doc.title} - ${doc.signer_name}`,
            html: `<p>${escapeHtml(doc.signer_name)} has signed "${escapeHtml(doc.title)}". It's now stored in the dashboard.</p>`,
          }),
        })
      }
    }

    return json({ ok: true })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

// ---------- helpers ----------
function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}
function stripBucket(u: string) { return u.replace(/^documents\//, '') }
function truthy(v: unknown) { return v !== undefined && v !== null && v !== '' && v !== false }
function stringifyVal(v: unknown) {
  if (typeof v === 'string' && v.startsWith('data:image')) return '[signature image]'
  return v == null ? null : String(v)
}
function slug(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'signer'
}
function decodeDataUrl(d: string) {
  const b64 = d.split(',')[1]
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
async function verifyPin(pin: string, hash: string) {
  const enc = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === hash
}
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}
