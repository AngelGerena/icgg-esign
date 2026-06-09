import React, { useEffect, useRef } from 'react'
import SignaturePad from 'signature_pad'

export default function SignatureCanvas({ label, clearLabel, onChange, error }) {
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d').scale(ratio, ratio)
    const pad = new SignaturePad(canvas, { penColor: '#1C2640', backgroundColor: 'rgba(255,255,255,0)' })
    padRef.current = pad
    pad.addEventListener('endStroke', () => {
      onChange(pad.isEmpty() ? '' : pad.toDataURL('image/png'))
    })
    return () => pad.off()
    // eslint-disable-next-line
  }, [])

  function clear() { padRef.current.clear(); onChange('') }

  return (
    <div>
      <div style={{ position: 'relative', border: `1.5px solid ${error ? 'var(--danger)' : 'var(--line)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--paper-card)', height: 130, touchAction: 'none' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        <span style={{ position: 'absolute', left: 12, bottom: 8, fontSize: 12, color: 'var(--muted)', pointerEvents: 'none' }}>{label}</span>
      </div>
      <button className="ghost sm" style={{ marginTop: 6 }} onClick={clear}>{clearLabel}</button>
    </div>
  )
}
