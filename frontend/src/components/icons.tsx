import type { SVGProps } from "react";

/**
 * A small, hand-crafted stroke-icon set (no icon-library dependency —
 * each icon is a few lines of inline SVG, tree-shaken automatically since
 * every icon is its own named export). Consistent 24x24 viewBox, 1.75
 * stroke width, currentColor — so size and color are controlled entirely
 * via the className callers already pass (e.g. `className="h-4 w-4"`).
 */

export type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function IconOverview(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 20V4a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M14 2.5V7h4.5" />
      <path d="M8 12h8M8 16h8M8 8h3" />
    </svg>
  );
}

export function IconGithub(props: IconProps) {
  return (
    <svg {...base(props)} strokeWidth={1.6}>
      <path d="M12 2a10 10 0 0 0-3.16 19.5c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.2-3.37-1.2-.46-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.93 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.83-2.34 4.68-4.57 4.92.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5V12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V5.5" />
      <path d="M4.5 12v6.5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V12" />
    </svg>
  );
}

export function IconMessage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.5 4V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2.5 4.5 5.5V11c0 5 3.2 8.4 7.5 10.5 4.3-2.1 7.5-5.5 7.5-10.5V5.5L12 2.5Z" />
      <path d="m8.5 12 2.4 2.4L15.5 10" />
    </svg>
  );
}

export function IconListChecks(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3.5 6 1.5 1.5L7.5 5" />
      <path d="m3.5 12.5 1.5 1.5 2.5-2.5" />
      <path d="m3.5 19 1.5 1.5L7.5 18" />
      <path d="M11.5 6h9M11.5 12.5h9M11.5 19h9" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19.5a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2.5a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8.5a1.65 1.65 0 0 0 1-1.51V2.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21.5a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 6h17M3.5 12h17M3.5 18h17" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h15M13 5.5 19.5 12 13 18.5" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function IconAlertCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

export function IconLoader(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v3.5M12 17.5V21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M3 12h3.5M17.5 12H21M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5" />
    </svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11 3.5 12.3 8l4.5 1.3-4.5 1.3L11 15l-1.3-4.4L5.2 9.3l4.5-1.3L11 3.5Z" />
      <path d="M18 15.5 18.8 18l2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8.8-2.5Z" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12a8 8 0 0 1 14.5-4.7M20 12a8 8 0 0 1-14.5 4.7" />
      <path d="M18.5 3v4.5H14M5.5 21v-4.5H10" />
    </svg>
  );
}

export function IconExternalLink(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 10 14" />
      <path d="M18 13v5.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H11" />
    </svg>
  );
}

export function IconLogOut(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5c1.2-3.4 4-5.5 7.5-5.5s6.3 2.1 7.5 5.5" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="1.5" />
      <path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2.5-7L14 19l2.5-7H21" />
    </svg>
  );
}

export function IconBox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function IconCommand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5A2.5 2.5 0 1 0 10.5 6H8V3.5ZM8 3.5A2.5 2.5 0 1 1 5.5 6H8V3.5Z" />
      <path d="M16 3.5A2.5 2.5 0 1 1 13.5 6H16V3.5ZM16 3.5A2.5 2.5 0 1 0 18.5 6H16V3.5Z" />
      <path d="M8 20.5A2.5 2.5 0 1 0 10.5 18H8v2.5ZM8 20.5A2.5 2.5 0 1 1 5.5 18H8v2.5Z" />
      <path d="M16 20.5A2.5 2.5 0 1 1 13.5 18H16v2.5ZM16 20.5A2.5 2.5 0 1 0 18.5 18H16v2.5Z" />
      <path d="M8 6h8v12H8V6Z" />
    </svg>
  );
}

export function IconGitBranch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="5" r="2.25" />
      <circle cx="6" cy="19" r="2.25" />
      <circle cx="18" cy="8" r="2.25" />
      <path d="M6 7.25V16.75" />
      <path d="M18 10.25V13a4 4 0 0 1-4 4H9" />
    </svg>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconChevronsUpDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8 9 4-4 4 4" />
      <path d="m8 15 4 4 4-4" />
    </svg>
  );
}

export function IconZap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.5 2.5 4.5 14h6l-1 7.5 8-11.5h-6l1-7.5Z" />
    </svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11.5 3.5H5A1.5 1.5 0 0 0 3.5 5v6.5a1.5 1.5 0 0 0 .44 1.06l9.5 9.5a1.5 1.5 0 0 0 2.12 0l6.94-6.94a1.5 1.5 0 0 0 0-2.12l-9.5-9.5a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.25" cy="8.25" r="1.25" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
      <path d="m6.5 9.5 3.5 3-3.5 3" />
      <path d="M12.5 15.5h5" />
    </svg>
  );
}

export function IconCircleDot(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4H5a1 1 0 0 0-1 1v4" />
      <path d="M15 4h4a1 1 0 0 1 1 1v4" />
      <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
      <path d="M15 20h4a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}
