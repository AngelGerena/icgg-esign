// supabase/functions/send-document/index.ts
// Called by an authenticated secretary. Sends the signing link by email via
// Resend, stamps the document status to 'sent', logs an audit event.
// Receipt confirmation: Resend delivered/opened webhooks (configured separately)
// hit the same audit_events table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { documentId } = await req.json()
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify the caller is an authenticated member of the doc's org
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: userData } = await admin.auth.getUser(jwt)
    if (!userData?.user) return json({ error: 'unauthorized' }, 401)

    const { data: doc, error } = await admin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()
    if (error || !doc) return json({ error: 'document not found' }, 404)

    const { data: membership } = await admin
      .from('org_members')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('org_id', doc.org_id)
      .maybeSingle()
    if (!membership) return json({ error: 'forbidden' }, 403)

    const appUrl = Deno.env.get('PUBLIC_APP_URL') || ''
    const signUrl = `${appUrl}/sign/${doc.signing_token}`
    const isEs = doc.lang === 'es'

    const subject = isEs
      ? `Documento para firmar: ${doc.title}`
      : `Document to sign: ${doc.title}`

    const body = isEs
      ? `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1C2640">
           <h2 style="color:#1C2640">${doc.title}</h2>
           <p>Hola ${escapeHtml(doc.signer_name)},</p>
           <p>Tiene un documento para revisar y firmar. Use el boton abajo.</p>
           <p><a href="${signUrl}" style="background:#C5A44B;color:#1C2640;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir y firmar</a></p>
           <p style="font-size:13px;color:#666">Necesitara el PIN de acceso que se le envio por separado.</p>
           <img src="${appUrl}/api/track/open?d=${doc.id}" width="1" height="1" alt="" />
         </div>`
      : `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1C2640">
           <h2 style="color:#1C2640">${doc.title}</h2>
           <p>Hello ${escapeHtml(doc.signer_name)},</p>
           <p>You have a document to review and sign. Use the button below.</p>
           <p><a href="${signUrl}" style="background:#C5A44B;color:#1C2640;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Open and sign</a></p>
           <p style="font-size:13px;color:#666">You'll need the access PIN sent to you separately.</p>
           <img src="${appUrl}/api/track/open?d=${doc.id}" width="1" height="1" alt="" />
         </div>`

    const resendKey = Deno.env.get('RESEND_API_KEY')!
    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'ICGG Documentos <documentos@finessemedia.pro>',
        to: [doc.signer_email],
        subject,
        html: body,
        tags: [{ name: 'document_id', value: doc.id }],
      }),
    })

    if (!sendResp.ok) {
      const e = await sendResp.text()
      return json({ error: 'email failed', detail: e }, 502)
    }

    await admin.from('documents').update({ status: 'sent' }).eq('id', doc.id)
    await admin.from('audit_events').insert({
      document_id: doc.id,
      event_type: 'sent',
      actor: `secretary:${userData.user.id}`,
      meta: { to: doc.signer_email },
    })

    return json({ ok: true, signUrl })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  )
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
