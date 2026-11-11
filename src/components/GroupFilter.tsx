import { useGroups } from '../lib/learning';

// "All students" or one group; staff only see the filter once they have a group.
export function GroupFilter({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const groups = useGroups();
  if (!groups.data?.length) return null;
  return (
    <div className="form-group mb-0 min-w-56">
      <label htmlFor="groupFilter">Guruh</label>
      <select id="groupFilter" value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">Barcha talabalar</option>
        {groups.data.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.member_count ?? 0})</option>)}
      </select>
    </div>
  );
}
