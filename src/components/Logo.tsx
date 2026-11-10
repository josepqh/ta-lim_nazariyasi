import { cx } from '../lib/format';

interface Props {
  size?: number;
  tone?: 'default' | 'onDark';
  wordmarkClass?: string;
}

export function Logo({ size = 40, tone = 'default', wordmarkClass }: Props) {
  return (
    <>
      <img src="/images/logo-96.png" alt="" width={size} height={size} className="shrink-0" style={{ width: size, height: size }}/>
      <span className={cx('flex flex-col whitespace-nowrap', wordmarkClass)}>
        <span className={cx('text-[17px] leading-none font-bold tracking-tight', tone === 'onDark' ? 'text-white' : 'text-ink')}>Ta'lim</span>
        <span className={cx('mt-0.5 text-[17px] leading-none font-bold tracking-tight', tone === 'onDark' ? 'text-white' : 'text-ink')}>Nazariyasi</span>
      </span>
    </>
  );
}
