/** NORO mark: two nodes joined by a routed signal line (input → processed output). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo__mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="#131517" stroke="#3a4045" strokeWidth="1.5" />
      <path d="M9 23V9l14 14V9" fill="none" stroke="#c9f45f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.6" fill="#eef0ee" />
      <circle cx="23" cy="23" r="2.6" fill="#eef0ee" />
    </svg>
  );
}
