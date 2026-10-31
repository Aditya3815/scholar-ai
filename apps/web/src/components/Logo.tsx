export function Logo() {
  return (
    <span className="logo">
      <svg className="logo-mark" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path className="logo-page logo-page-l" d="M16 9.5c-2.2-1.4-5-1.8-8-1.3v13.3c3-.5 5.8-.1 8 1.3V9.5Z" fill="var(--accent-fg)" opacity="0.92" />
        <path className="logo-page logo-page-r" d="M16 9.5c2.2-1.4 5-1.8 8-1.3v13.3c-3-.5-5.8-.1-8 1.3V9.5Z" fill="var(--accent-fg)" opacity="0.62" />
      </svg>
      <span className="logo-word">Sodhsetu</span>
    </span>
  );
}
