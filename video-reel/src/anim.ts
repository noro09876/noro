import { Easing, interpolate } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const outExpo = Easing.bezier(0.16, 1, 0.3, 1);
export const outBack = Easing.bezier(0.34, 1.56, 0.64, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0→1 over [at, at+dur] */
export const prog = (frame: number, at: number, dur: number, easing = outExpo) =>
  interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing });

/** 1 while visible, eased 0→1 in and 1→0 out */
export const inOutProg = (frame: number, at: number, out: number, inDur = 9, outDur = 6) => ({
  pin: prog(frame, at, inDur),
  pout: interpolate(frame, [out - outDur, out], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) }),
  visible: frame >= at - 1 && frame < out,
});
