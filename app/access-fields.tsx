"use client";

export function PinField({ label, value, onChange, fresh = false }: { label: string; value: string; onChange: (value: string) => void; fresh?: boolean }) {
  return <label>{label}<input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete={fresh ? 'new-password' : 'current-password'} required value={value} onChange={event => onChange(event.target.value)} placeholder="数字6桁" className="access-pin" /><span className="access-field-note">0から始まる番号も使えます。</span></label>;
}
