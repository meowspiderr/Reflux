interface LogoProps {
  size?: number;
  strokeWidth?: number;
}

export function Logo({ size = 18, strokeWidth = 2.3 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 4.78H8.2a3.4 3.4 0 0 0-3.4 3.4v6.17" />
      <path d="M8.45 19.22h7.35a3.4 3.4 0 0 0 3.4-3.4V9.74" />
    </svg>
  );
}
