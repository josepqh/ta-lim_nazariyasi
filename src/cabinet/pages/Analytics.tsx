import { useQuery } from '@tanstack/react-query';
import { ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Legend, LinearScale, Tooltip } from 'chart.js';
import { Award, BarChart2, Check, Layers, PieChart, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GroupFilter } from '../../components/GroupFilter';
import { PageSkeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { motionAllowed } from '../../lib/format';
import { useModules } from '../../lib/queries';
import { navigate } from '../../store';
import type { Progress, StepId } from '../../types';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, DoughnutController, ArcElement, Legend, Tooltip);

const STEP_LABELS: [StepId, string][] = [['diag', 'Diagnostika'], ['video', 'Video dars'], ['pres', 'Taqdimot'], ['doc', 'Material'], ['task', 'Topshiriq'], ['refl', 'Refleksiya']];

function useChart(build: (canvas: HTMLCanvasElement) => Chart | null, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = build(ref.current);
    return () => chart?.destroy();
    // The chart is rebuilt only when its data changes.
  }, deps);
  return ref;
}

export default function Analytics() {
  const modules = useModules();
  const [groupId, setGroupId] = useState<number | null>(null);
  const rows = useQuery({
    queryKey: groupId ? ['progress', 'all', groupId] : ['progress', 'all'],
    queryFn: () => api<Progress[]>(groupId ? `/progress?group_id=${groupId}` : '/progress')
  });
  const list = modules.data ?? [];
  const all = rows.data ?? [];

  const completion = list.map((module) => {
    const relevant = all.filter((row) => row.module_id === module.id);
    return relevant.length ? Math.round((relevant.filter((row) => row.completed_steps.length >= 6).length / relevant.length) * 100) : 0;
  });
  const stepCounts = Object.fromEntries(STEP_LABELS.map(([id]) => [id, 0])) as Record<StepId, number>;
  all.forEach((row) => row.completed_steps.forEach((step) => { if (step in stepCounts) stepCounts[step] += 1; }));

  const moduleStats = list.map((module) => {
    const relevant = all.filter((row) => row.module_id === module.id);
    const finished = relevant.filter((row) => row.completed_steps.length >= 6).length;
    const quizzes = relevant.map((row) => row.step_responses?.diag_result).filter(Boolean) as { correct: number; total: number }[];
    const total = quizzes.reduce((sum, quiz) => sum + Number(quiz.total), 0);
    const correct = quizzes.reduce((sum, quiz) => sum + Number(quiz.correct), 0);
    return { module, started: relevant.length, finished, inProgress: relevant.length - finished, quizAverage: total ? Math.round((correct / total) * 100) : null };
  });

  const students = new Map<number, { id: number; name: string; steps: number; score: number; finished: number; correct: number; total: number }>();
  all.forEach((row) => {
    const entry = students.get(row.user_id) ?? { id: row.user_id, name: row.student_name || row.student_login || `Talaba #${row.user_id}`, steps: 0, score: 0, finished: 0, correct: 0, total: 0 };
    entry.steps += row.completed_steps.length;
    entry.score += row.total_score || 0;
    entry.correct += Number(row.step_responses?.diag_result?.correct) || 0;
    entry.total += Number(row.step_responses?.diag_result?.total) || 0;
    if (row.completed_steps.length >= 6) entry.finished += 1;
    students.set(row.user_id, entry);
  });
  const leaderboard = [...students.values()].sort((a, b) => b.steps - a.steps || b.score - a.score);
  const hasModuleData = all.length > 0 && list.length > 0;
  const hasStepData = all.some((row) => row.completed_steps.length > 0);
  const animation = motionAllowed() ? undefined : (false as const);

  const barRef = useChart((canvas) => (hasModuleData ? new Chart(canvas, {
    type: 'bar',
    data: {
      labels: list.map((module) => `Modul ${module.order_num}`),
      datasets: [{ label: 'O‘zlashtirish darajasi (%)', data: completion, backgroundColor: '#A89B8C', borderColor: '#8F8171', borderWidth: 1, borderRadius: 2 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } } },
      plugins: { legend: { display: false } }
    }
  }) : null), [hasModuleData, completion.join(',')]);

  const doughnutRef = useChart((canvas) => (hasStepData ? new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: STEP_LABELS.map(([, label]) => label),
      datasets: [{
        data: STEP_LABELS.map(([id]) => stepCounts[id]),
        backgroundColor: ['#A89B8C', '#8C6A3F', '#C9B99A', '#D4B896', '#7A7571', '#333130'],
        borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-alt').trim()
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, animation, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
  }) : null), [hasStepData, STEP_LABELS.map(([id]) => stepCounts[id]).join(',')]);

  if (rows.isLoading || modules.isLoading) return <PageSkeleton/>;
  if (rows.isError) return <div className="card">Ma'lumotlarni yuklab bo‘lmadi.</div>;

  const empty = <p className="muted-text empty-text">Hozircha ma'lumot yo‘q.</p>;
  const openStudent = (id: number) => navigate('student-detail', id);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3"><GroupFilter value={groupId} onChange={setGroupId}/></div>
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-header"><h4><BarChart2/> Modullar bo‘yicha o‘zlashtirish (%)</h4><p>To‘liq yakunlash koeffitsiyenti</p></div>
          <div className="chart-wrapper">{hasModuleData ? <canvas ref={barRef} id="chartModules" role="img" aria-label="Modullar bo‘yicha o‘zlashtirish foizi"/> : empty}</div>
        </div>
        <div className="chart-card">
          <div className="chart-header"><h4><PieChart/> Qadamlar faolligi taqsimoti</h4><p>Didaktik bosqichlar</p></div>
          <div className="chart-wrapper">{hasStepData ? <canvas ref={doughnutRef} id="chartSteps" role="img" aria-label="Bajarilgan qadamlar taqsimoti"/> : empty}</div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title flex items-center gap-2"><Layers/> Modullar kesimida</h3>
        {moduleStats.length ? (
          <div className="min-w-0">
            <table className="leaderboard-table module-stats-table">
              <thead><tr><th className="col-left">Modul</th><th>Boshlaganlar</th><th>Tugatganlar</th><th>Jarayonda</th><th>O‘rtacha test natijasi</th></tr></thead>
              <tbody>
                {moduleStats.map(({ module, started, finished, inProgress, quizAverage }) => (
                  <tr key={module.id}>
                    <td data-label="Modul" className="col-left"><strong>Modul {Number(module.order_num)}. {module.title}</strong></td>
                    <td data-label="Boshlaganlar">{started} ta</td>
                    <td data-label="Tugatganlar"><span className={`badge ${finished ? 'badge-success' : 'badge-muted'}`}>{finished} ta</span></td>
                    <td data-label="Jarayonda">{inProgress} ta</td>
                    <td data-label="O‘rtacha test">{quizAverage === null ? '—' : `${quizAverage}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted-text">Hozircha modullar yo‘q.</p>}
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <h3 className="card-title m-0 flex items-center gap-2 border-0 p-0"><Trophy className="text-accent"/> Talabalar reytingi</h3>
          <span className="badge badge-primary">Didaktik monitoring</span>
        </div>
        <p className="mb-5 text-sm text-muted">Modullardagi 6 qadamli didaktik vazifalarni eng faol bajargan va eng yuqori natija ko‘rsatgan talabalar:</p>
        <div className="min-w-0">
          <table className="leaderboard-table">
            <thead>
              <tr><th className="w-[70px]">O‘rin</th><th className="col-left">Talaba F.I.Sh</th><th>Bajarilgan qadamlar</th><th>Test natijasi</th><th>Tugatilgan modullar</th><th>Toplangan ball</th><th>Holat</th></tr>
            </thead>
            <tbody>
              {!leaderboard.length && <tr><td colSpan={7} className="p-5 text-center text-muted">Hozircha talabalar natijalari mavjud emas.</td></tr>}
              {leaderboard.map((student, index) => (
                <tr key={student.id} className="clickable-row" onClick={() => openStudent(student.id)} title="Bajargan ishlarini ko‘rish">
                  <td data-label="O‘rin"><span className={`rank-badge ${index < 3 ? `rank-${index + 1}` : 'rank-default'}`}>{index + 1}</span></td>
                  <td data-label="Talaba" className="col-left"><button type="button" className="link-btn" onClick={(event) => { event.stopPropagation(); openStudent(student.id); }}>{student.name}</button></td>
                  <td data-label="Qadamlar"><Check className="w-[14px] text-success"/> {student.steps} ta qadam</td>
                  <td data-label="Test">{student.total ? <><strong>{student.correct}/{student.total}</strong> <span className="muted-text">({student.total - student.correct} ta xato)</span></> : '—'}</td>
                  <td data-label="Modullar"><span className={`badge ${student.finished > 0 ? 'badge-success' : 'badge-muted'}`}>{student.finished} ta modul</span></td>
                  <td data-label="Ball"><strong>{student.score} XP</strong></td>
                  <td data-label="Holat">{student.finished > 0 ? <span className="badge badge-success"><Award/> A'lochi</span> : <span className="badge badge-primary">Faol</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
