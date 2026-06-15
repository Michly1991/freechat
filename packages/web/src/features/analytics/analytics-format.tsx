export const nf = new Intl.NumberFormat('zh-CN')

export function n(value: any) { return nf.format(Math.round(Number(value || 0))) }
export function pct(value: any) { return `${(Number(value || 0) * 100).toFixed(1)}%` }
export function ms(value: any) {
  const v = Number(value || 0)
  if (!v) return '-'
  if (v < 1000) return `${Math.round(v)}ms`
  if (v < 60000) return `${(v / 1000).toFixed(1)}s`
  return `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s`
}
export function time(value: any) { return value ? new Date(Number(value)).toLocaleString() : '-' }

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
  </div>
}
