// src/dashboard/screens/OverviewScreen.tsx — at-a-glance counters (live app DB).
import { useStats } from '../lib/hooks'

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={`dv-stat${accent ? ' is-accent' : ''}`}>
      <span className="dv-stat__label">{label}</span>
      <div className="dv-stat__value">{value}</div>
    </div>
  )
}

export function OverviewScreen() {
  const { data, isLoading } = useStats()
  const v = (n?: number) => (isLoading ? '—' : (n ?? 0))
  return (
    <section>
      <p className="dv-kicker">Moderation · Overview</p>
      <h1 className="dv-h1">Welcome back</h1>
      <p className="dv-sub">Members, reports, events and content — moderated from one place.</p>
      <div className="dv-stats">
        <Stat label="Members" value={v(data?.members)} />
        <Stat label="Open reports" value={v(data?.openReports)} accent={(data?.openReports ?? 0) > 0} />
        <Stat label="Under review" value={v(data?.underReview)} />
        <Stat label="Banned" value={v(data?.banned)} />
        <Stat label="Events" value={v(data?.events)} />
      </div>
    </section>
  )
}
