import React from "react";
import { useCurrentFrame } from "remotion";
import { inOutProg } from "../anim";
import { FONT_HEAD, FONT_LIGHT, WHITE } from "../config";

type Base = {
  /** frame the element starts animating in / is fully gone */
  at: number;
  out: number;
  /** top edge in px (frame space 1080×1920) */
  y: number;
  size: number;
  align?: "center" | "left" | "right";
  x?: number; // horizontal offset from the aligned position
  color?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const box = (align: Base["align"], x = 0): React.CSSProperties => ({
  position: "absolute",
  left: 0,
  width: 1080,
  display: "flex",
  justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
  paddingLeft: align === "left" ? 70 + x : 0,
  paddingRight: align === "right" ? 70 - x : 0,
  translate: align === "center" || !align ? `${x}px 0px` : undefined,
  boxSizing: "border-box",
});

/** Big CAPS headline. Flies in from a large blurred state and snaps into place (as in the reference). */
export const Headline: React.FC<Base & { zoomFrom?: number; inDur?: number; lineHeight?: number; tracking?: number; shadow?: boolean }> = ({
  at, out, y, size, align = "center", x, color = WHITE, children, zoomFrom = 2.4, inDur = 10, lineHeight = 0.98, tracking = -0.012, shadow = true, style,
}) => {
  const frame = useCurrentFrame();
  const { pin, pout, visible } = inOutProg(frame, at, out, inDur, 6);
  if (!visible) return null;
  const scale = (zoomFrom + (1 - zoomFrom) * pin) * (1 - 0.04 * pout);
  const blur = (1 - pin) * 26 + pout * 14;
  return (
    <div style={{ ...box(align, x), top: y }}>
      <div
        style={{
          fontFamily: FONT_HEAD, fontWeight: 900, fontSize: size, lineHeight, letterSpacing: `${tracking}em`,
          color, textTransform: "uppercase", whiteSpace: "pre", textAlign: align,
          opacity: Math.min(1, pin * 2.2) * (1 - pout),
          scale: String(scale), filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
          transformOrigin: align === "center" ? "50% 50%" : align === "right" ? "85% 50%" : "15% 50%",
          textShadow: shadow ? "0 6px 40px rgba(0,0,0,0.38), 0 2px 6px rgba(0,0,0,0.25)" : undefined,
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Thin lowercase companion line. Soft blur-reveal with a small rise. */
export const Light: React.FC<Base & { weight?: number }> = ({ at, out, y, size, align = "center", x, color = WHITE, children, weight = 300, style }) => {
  const frame = useCurrentFrame();
  const { pin, pout, visible } = inOutProg(frame, at, out, 8, 5);
  if (!visible) return null;
  const blur = (1 - pin) * 16 + pout * 10;
  return (
    <div style={{ ...box(align, x), top: y }}>
      <div
        style={{
          fontFamily: FONT_LIGHT, fontWeight: weight, fontSize: size, lineHeight: 1, letterSpacing: "0.01em",
          color, whiteSpace: "pre", textTransform: "lowercase",
          opacity: pin * (1 - pout), translate: `0px ${(1 - pin) * 16 - pout * 8}px`,
          filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
          textShadow: "0 3px 22px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3)",
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Word-by-word thin captions (one word/phrase on screen at a time), synced to speech. */
export const Words: React.FC<{ items: [number, string][]; end: number; y: number; size?: number }> = ({ items, end, y, size = 58 }) => (
  <>
    {items.map(([at, w], i) => (
      <Light key={i} at={at} out={i < items.length - 1 ? items[i + 1][0] + 2 : end} y={y} size={size}>
        {w}
      </Light>
    ))}
  </>
);
