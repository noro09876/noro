import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, inOutProg, outBack, outExpo, prog } from "../anim";
import { ACCENT, FONT_HEAD, FONT_LIGHT, FONT_TAG, HANDLE, INK, WHITE } from "../config";

const stroke = { fill: "none", stroke: WHITE, strokeWidth: 5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconFamily: React.FC<{ s?: number }> = ({ s = 64 }) => (
  <svg width={s} height={s} viewBox="0 0 64 64">
    <circle cx="18" cy="15" r="7" {...stroke} /><path d="M6 50V38a12 12 0 0 1 24 0v12" {...stroke} />
    <circle cx="46" cy="15" r="7" {...stroke} /><path d="M34 50V38a12 12 0 0 1 24 0v12" {...stroke} />
    <circle cx="32" cy="36" r="5.5" {...stroke} fill="rgba(20,22,27,0.55)" /><path d="M23 58v-5a9 9 0 0 1 18 0v5" {...stroke} fill="rgba(20,22,27,0.55)" />
  </svg>
);
export const IconPerson: React.FC<{ s?: number }> = ({ s = 64 }) => (
  <svg width={s} height={s} viewBox="0 0 64 64">
    <circle cx="32" cy="19" r="10" {...stroke} /><path d="M12 56V48a20 20 0 0 1 40 0v8" {...stroke} />
  </svg>
);
const Check: React.FC<{ p: number }> = ({ p }) => (
  <svg width={54} height={54} viewBox="0 0 54 54">
    <circle cx="27" cy="27" r="25" fill={ACCENT} />
    <path d="M15 28l8 8 16-17" fill="none" stroke="#fff" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - p)} />
  </svg>
);

/** Frosted pill with icon + CAPS label (+ optional check). Pops in with a little overshoot. */
export const Pill: React.FC<{ at: number; out: number; x: number; y: number; label: string; icon?: React.ReactNode; check?: number; size?: number }> = ({
  at, out, x, y, label, icon, check, size = 40,
}) => {
  const frame = useCurrentFrame();
  const { pout, visible } = inOutProg(frame, at, out, 10, 6);
  if (!visible) return null;
  const p = prog(frame, at, 12, outBack);
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, translate: "-50% 0px", display: "flex", alignItems: "center", gap: 20,
        padding: icon ? "18px 34px 18px 26px" : "20px 38px", borderRadius: 999,
        background: "rgba(16,20,30,0.46)", border: "2px solid rgba(245,241,232,0.55)", backdropFilter: "blur(14px)",
        boxShadow: "0 14px 50px rgba(0,0,0,0.28)",
        opacity: Math.min(1, p * 1.6) * (1 - pout), scale: String(0.6 + 0.4 * p - 0.05 * pout),
      }}
    >
      {icon}
      <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: size, color: WHITE, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{label}</span>
      {check !== undefined ? <Check p={prog(frame, check, 8)} /> : null}
    </div>
  );
};

/** Accent strike-through that wipes across a headline ("не семейная ипотека"). */
export const Strike: React.FC<{ at: number; out: number; y: number; width: number }> = ({ at, out, y, width }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame >= out) return null;
  const p = prog(frame, at, 9, outExpo);
  const o = interpolate(frame, [out - 5, out], [1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: (1080 - width) / 2, top: y, width: width * p, height: 12, borderRadius: 6, background: ACCENT, opacity: o, rotate: "-1.6deg", transformOrigin: "0% 50%", boxShadow: "0 4px 18px rgba(0,0,0,0.35)" }} />
  );
};

/** "For the whole term": a line that draws itself with the 2% tag riding along it. */
export const TermLine: React.FC<{ at: number; out: number; y: number }> = ({ at, out, y }) => {
  const frame = useCurrentFrame();
  const { pout, visible } = inOutProg(frame, at, out, 8, 6);
  if (!visible) return null;
  const W = 780, L = (1080 - W) / 2;
  const p = prog(frame, at, 34, outExpo);
  const o = Math.min(1, prog(frame, at, 6) * 2) * (1 - pout);
  return (
    <div style={{ position: "absolute", left: L, top: y, width: W, height: 90, opacity: o }}>
      <div style={{ position: "absolute", left: 0, top: 43, width: W, height: 4, borderRadius: 2, background: "rgba(245,241,232,0.28)" }} />
      <div style={{ position: "absolute", left: 0, top: 43, width: W * p, height: 4, borderRadius: 2, background: WHITE }} />
      {[0, 1].map((i) => (
        <div key={i} style={{ position: "absolute", left: i * W - 9, top: 36, width: 18, height: 18, borderRadius: 9, background: i <= p ? WHITE : "rgba(245,241,232,0.4)" }} />
      ))}
      <div style={{ position: "absolute", left: W * p, top: 45, translate: "-50% -50%", padding: "10px 26px", borderRadius: 999, background: ACCENT, fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 40, color: "#fff", boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}>2%</div>
    </div>
  );
};

/** Tear-off calendar tile — the "graphic insert" of the date block. */
export const Calendar: React.FC<{ at: number; out: number; y: number; yearAt: number }> = ({ at, out, y, yearAt }) => {
  const frame = useCurrentFrame();
  const { pout, visible } = inOutProg(frame, at, out, 10, 6);
  if (!visible) return null;
  const p = prog(frame, at, 14, outBack);
  const yp = prog(frame, yearAt, 10, outBack);
  return (
    <div
      style={{
        position: "absolute", left: 540, top: y, width: 330, translate: "-50% 0px", borderRadius: 46, overflow: "hidden", background: "#FBF8F1",
        boxShadow: "0 30px 90px rgba(0,0,0,0.5)", rotate: `${-5 + 2 * p}deg`, scale: String(0.5 + 0.5 * p - 0.06 * pout), opacity: Math.min(1, p * 1.8) * (1 - pout),
      }}
    >
      <div style={{ background: ACCENT, height: 84, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 34, color: "#fff", letterSpacing: "0.04em" }}>ЯНВАРЬ</div>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 200, lineHeight: 1.12, color: INK, textAlign: "center", marginTop: -2 }}>1</div>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 52, color: yp > 0.02 ? ACCENT : "rgba(20,22,27,0.28)", textAlign: "center", paddingBottom: 30, marginTop: -14, scale: String(1 + 0.18 * (yp > 0 ? 1 - yp : 0)) }}>2026</div>
    </div>
  );
};

/** Rising chart line for "для вложений". */
export const Growth: React.FC<{ at: number; out: number; y: number }> = ({ at, out, y }) => {
  const frame = useCurrentFrame();
  const { pout, visible } = inOutProg(frame, at, out, 8, 6);
  if (!visible) return null;
  const p = prog(frame, at, 22, outExpo);
  const len = 900;
  return (
    <svg width={640} height={300} viewBox="0 0 640 300" style={{ position: "absolute", left: 220, top: y, opacity: 1 - pout, filter: "drop-shadow(0 8px 26px rgba(0,0,0,0.45))" }}>
      <path d="M20 270 L170 215 L270 235 L420 130 L500 150 L610 36" fill="none" stroke={WHITE} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
      <g opacity={prog(frame, at + 14, 6)}>
        <path d="M552 30 L614 30 L614 92" fill="none" stroke={ACCENT} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
};

/** Comment bubble with the code word — plays the role of the animated social icon on the reference end card. */
export const CommentBubble: React.FC<{ at: number; size?: number }> = ({ at, size = 250 }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, at, 14, outBack);
  const two = prog(frame, at + 9, 10, outBack);
  const pulse = 1 + 0.035 * Math.sin(Math.max(0, frame - at - 14) / 7);
  return (
    <div style={{ width: size, height: size, scale: String((0.4 + 0.6 * p) * pulse), opacity: Math.min(1, p * 2), position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 250 250">
        <defs>
          <linearGradient id="bub" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#F2A03D" /><stop offset="0.55" stopColor={ACCENT} /><stop offset="1" stopColor="#C2305A" />
          </linearGradient>
        </defs>
        <path d="M125 22c58 0 103 39 103 90s-45 90-103 90c-13 0-26-2-37-6l-48 26 13-47c-19-16-31-38-31-63 0-51 45-90 103-90z" fill="url(#bub)" />
      </svg>
      <div style={{ position: "absolute", left: 0, top: 26, width: size, textAlign: "center", fontFamily: FONT_HEAD, fontWeight: 900, fontSize: 128, lineHeight: "170px", color: "#fff", scale: String(0.3 + 0.7 * two), opacity: Math.min(1, two * 2) }}>2</div>
    </div>
  );
};

/** Optional persistent handle tag (hidden while HANDLE is empty). */
export const HandleTag: React.FC<{ x: number; y: number; align?: "left" | "right" }> = ({ x, y, align = "right" }) => {
  if (!HANDLE) return null;
  return (
    <div style={{ position: "absolute", top: y, [align]: x, display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start", gap: 14, opacity: 0.95 } as React.CSSProperties}>
      <svg width={40} height={40} viewBox="0 0 40 40" fill="none" stroke={WHITE} strokeWidth={3.4}>
        <rect x="4" y="4" width="32" height="32" rx="9" /><circle cx="20" cy="20" r="7.5" /><circle cx="29.5" cy="10.5" r="1.4" fill={WHITE} />
      </svg>
      <div style={{ fontFamily: FONT_TAG, fontSize: 30, letterSpacing: "0.03em", color: WHITE }}>{HANDLE.toUpperCase()}</div>
    </div>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(120% 85% at 50% 45%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.26) 100%)", pointerEvents: "none" }} />
);
export { FONT_LIGHT };
