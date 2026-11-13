/** Planr's mark: a timeline with three points, the middle one ("now") filled. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6.5" fill="var(--accent)" />
      <path d="M5 12h14" stroke="var(--accent-text)" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
      <circle cx="6.5" cy="12" r="1.9" fill="var(--accent)" stroke="var(--accent-text)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill="var(--accent-text)" />
      <circle cx="17.5" cy="12" r="1.9" fill="var(--accent)" stroke="var(--accent-text)" strokeWidth="1.5" />
    </svg>
  );
}
