export function UploadProgress({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  return (
    <div id="uploadProgress" className="upload-progress">
      <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${percent}%` }}/></div>
      <span className="upload-progress-text" aria-live="polite">Yuklanmoqda: {percent}%</span>
    </div>
  );
}
