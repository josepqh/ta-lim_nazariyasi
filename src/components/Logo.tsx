import { cx } from '../lib/format';

interface Props {
  size?: number;
  tone?: 'default' | 'onDark';
  wordmarkClass?: string;
}

// The TN monogram: the T's stem doubles as the N's first stroke. Same shapes as public/images/logo.svg.
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className="shrink-0" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="116" fill="#2B2621"/>
      {/* A faint light rim keeps the dark tile's edge visible on dark navbars and the footer. */}
      <rect x="6" y="6" width="500" height="500" rx="110" fill="none" stroke="#F3EADB" strokeOpacity="0.16" strokeWidth="12"/>
      <path d="M176 140h56l180 232h-56z" fill="#F3EADB"/>
      <path d="M356 140h56v232h-56z" fill="#F3EADB"/>
      <path d="M100 140h208v56h-76v176h-56V196h-76z" fill="#CFAE7E" stroke="#2B2621" strokeWidth="18" paintOrder="stroke"/>
    </svg>
  );
}

export function Logo({ size = 40, tone = 'default', wordmarkClass }: Props) {
  return (
    <>
      <LogoMark size={size}/>
      <span className={cx('flex flex-col whitespace-nowrap', wordmarkClass)}>
        <span className={cx('text-[17px] leading-none font-bold tracking-tight', tone === 'onDark' ? 'text-white' : 'text-ink')}>Ta'lim</span>
        <span className={cx('mt-0.5 text-[17px] leading-none font-bold tracking-tight', tone === 'onDark' ? 'text-white' : 'text-ink')}>Nazariyasi</span>
      </span>
    </>
  );
}
