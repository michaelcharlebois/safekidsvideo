/*
 * A small, consistent icon set (24px grid, 1.75 stroke, round joins) drawn for Brightframe, so the UI
 * doesn't depend on emoji glyphs that render differently on every device. Decorative by default.
 */
import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 20, title, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} {...rest}>
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Svg>;
export const IconReview = (p: P) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></Svg>;
export const IconKids = (p: P) => <Svg {...p}><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16 14.2c2.3.1 4 1.8 4.5 4.3" /></Svg>;
export const IconAccount = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconPlayCircle = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M10.2 8.8v6.4l5.1-3.2z" fill="currentColor" stroke="none" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M10.3 4.6 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 16.8v.01" /></Svg>;
export const IconHand = (p: P) => <Svg {...p}><path d="M8 12V5.8a1.4 1.4 0 0 1 2.8 0V11M10.8 10.5V4.6a1.4 1.4 0 0 1 2.8 0V11M13.6 10.8V5.6a1.4 1.4 0 0 1 2.8 0v6.8M16.4 9.8a1.4 1.4 0 0 1 2.8 0v4.4a6.4 6.4 0 0 1-6.4 6.3h-.7a6 6 0 0 1-4.7-2.3l-3-3.8a1.5 1.5 0 0 1 2.3-1.9L8 14" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" /><path d="m9.2 12 2 2 3.8-4" /></Svg>;
export const IconEyeOff = (p: P) => <Svg {...p}><path d="M3.5 3.5l17 17M10 6.2A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.7 7.7C4.9 8.9 3.6 10.6 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>;
export const IconBan = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconTv = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="12" rx="2.5" /><path d="M8.5 20.5h7" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
export const IconChannels = (p: P) => <Svg {...p}><rect x="3.5" y="5" width="17" height="11" rx="2.5" /><path d="M7 19.5h10" /><path d="M10.5 8.5v4l3.5-2z" fill="currentColor" stroke="none" /></Svg>;
export const IconArrowUp = (p: P) => <Svg {...p}><path d="m7 14 5-5 5 5" /></Svg>;
export const IconArrowDown = (p: P) => <Svg {...p}><path d="m7 10 5 5 5-5" /></Svg>;
export const IconSparkle = (p: P) => <Svg {...p}><path d="M12 4.5c.6 3.4 2.1 4.9 5.5 5.5-3.4.6-4.9 2.1-5.5 5.5-.6-3.4-2.1-4.9-5.5-5.5 3.4-.6 4.9-2.1 5.5-5.5z" /></Svg>;
