// Grey shapes in the layout of the page that is coming, so waiting reads as "almost there", not as a stall.
const Bar = ({ className }: { className: string }) => <div className={`skeleton ${className}`}/>;

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4 py-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Bar className="size-10 shrink-0 rounded-full"/>
          <div className="flex-1 space-y-2"><Bar className="h-4 w-2/5"/><Bar className="h-3 w-3/4"/></div>
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Yuklanmoqda">
      <div className="dashboard-grid" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="stat-card">
            <Bar className="size-12 shrink-0 rounded-xl"/>
            <div className="flex-1 space-y-2"><Bar className="h-6 w-2/5"/><Bar className="h-3 w-3/5"/></div>
          </div>
        ))}
      </div>
      <div className="card"><Bar className="mb-5 h-5 w-1/3"/><ListSkeleton/></div>
    </div>
  );
}
