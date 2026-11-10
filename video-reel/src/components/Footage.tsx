import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, outExpo } from "../anim";
import { SPEECH_FRAMES } from "../config";

export type Cam = {
  from: number; to: number;
  /** scale at the start / end of the shot (slow push or pull) */
  s0: number; s1: number;
  /** transform origin in % — oy:0 pushes the head DOWN leaving more sky for titles */
  ox?: number; oy?: number;
};

const camAt = (cams: Cam[], frame: number) => {
  const c = cams.find((k) => frame >= k.from && frame < k.to) ?? cams[cams.length - 1];
  const drift = interpolate(frame, [c.from, c.to], [c.s0, c.s1], clamp);
  // tiny "settle" punch on every cut: 5 frames from +5% to 0
  const punch = interpolate(frame, [c.from, c.from + 6], [0.05, 0], { ...clamp, easing: outExpo });
  return { scale: drift * (1 + punch), ox: c.ox ?? 50, oy: c.oy ?? 30 };
};

/**
 * The client's footage in three layers:
 *   background video → `behind` (gradients, titles that sit BEHIND the speaker) → speaker cut-out.
 * `dim` (0..1) darkens + blurs everything for the end card.
 */
export const Speaker: React.FC<{ cams: Cam[]; behind?: React.ReactNode; dim?: number; skyShade?: number }> = ({ cams, behind, dim = 0, skyShade = 1 }) => {
  const frame = useCurrentFrame();
  const { scale, ox, oy } = camAt(cams, frame);
  const src = Math.min(frame, SPEECH_FRAMES - 1); // freeze on the last frame during the end-card tail
  const t: React.CSSProperties = { scale: String(scale), transformOrigin: `${ox}% ${oy}%`, filter: dim > 0.01 ? `blur(${dim * 7}px)` : undefined };
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0d12" }}>
      <AbsoluteFill style={t}>
        <OffthreadVideo src={staticFile("client.mp4")} muted style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
      {/* shade the bright sky so white type stays readable — sits behind the speaker */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(7,12,24,${Math.min(0.92, 0.66 * skyShade)}) 0%, rgba(7,12,24,${Math.min(0.85, 0.5 * skyShade)}) 22%, rgba(7,12,24,${Math.min(0.6, 0.22 * skyShade)}) 42%, rgba(7,12,24,0) 62%)`,
        }}
      />
      {behind}
      <AbsoluteFill style={t}>
        <Img src={staticFile(`fg/f_${String(src).padStart(4, "0")}.webp`)} style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 22%)" }} />
    </AbsoluteFill>
  );
};

/** Full-screen photo plate with a slow camera move + dark gradients for type (like the reference b-roll). */
export const Broll: React.FC<{
  src: string; from: number; to: number;
  s0?: number; s1?: number; x0?: number; x1?: number; y0?: number; y1?: number; ox?: number; oy?: number;
}> = ({ src, from, to, s0 = 1.02, s1 = 1.12, x0 = 0, x1 = 0, y0 = 0, y1 = 0, ox = 50, oy = 50 }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const k = interpolate(frame, [from, to], [0, 1], clamp);
  const punch = interpolate(frame, [from, from + 7], [0.07, 0], { ...clamp, easing: outExpo });
  const blur = interpolate(frame, [from, from + 4], [5, 0], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          scale: String((s0 + (s1 - s0) * k) * (1 + punch)),
          translate: `${x0 + (x1 - x0) * k}px ${y0 + (y1 - y0) * k}px`,
          transformOrigin: `${ox}% ${oy}%`,
          filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
        }}
      >
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.58) 20%, rgba(0,0,0,0.18) 42%, rgba(0,0,0,0) 56%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.42) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
