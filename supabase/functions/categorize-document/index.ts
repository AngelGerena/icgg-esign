// supabase/functions/categorize-document/index.ts
// AI-powered categorization. The secretary uploads a PDF; the front end
// extracts the first ~3000 chars of text and posts it here. We ask Claude
// to classify into one of the church's categories and return strict JSON.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CATEGORIES = [
  'membership',
  'baptism',
  'child_dedication',
  'covering',
  'volunteer',
  'financial',
  'other',
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { documentText, fileName } = await req.json()

    if (!documentText || documentText.trim().length < 10) {
      return json({ category: 'other', confidence: 0, reason: 'too little text' })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ category: 'other', confidence: 0, reason: 'no api key' }, 200)

    const system = `You classify church documents for Iglesia Cristiana Gracia y Gloria.
Return ONLY a JSON object, no prose, no markdown fences.
Allowed categories: ${CATEGORIES.join(', ')}.
Schema: {"category": "<one allowed value>", "confidence": <0-1>, "suggested_ministry": "<General|Youth|Worship|Children|Outreach>", "title": "<short human title>"}
Documents may be in Spanish or English. "covering" = a church requesting spiritual covering/oversight.`

    const userMsg = `File name: ${fileName || 'unknown'}\n\nDocument text (truncated):\n${String(documentText).slice(0, 3000)}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })

    const data = await resp.json()
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { category: 'other', confidence: 0, suggested_ministry: 'General', title: fileName || 'Document' }
    }

    if (!CATEGORIES.includes(parsed.category)) parsed.category = 'other'

    return json(parsed)
  } catch (err) {
    return json({ category: 'other', confidence: 0, error: String(err) }, 200)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
