// ─────────────────────────────────────────────────────────────────────────────
//  Global look & project settings. Change things here first.
// ─────────────────────────────────────────────────────────────────────────────
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Speech ends at frame 1056 (35.2 s); the end card holds a little longer. */
export const SPEECH_FRAMES = 1056;
export const DURATION = 1104;

/** Instagram handle shown as a small persistent tag + on the end card.
 *  Leave empty to hide it (the client's handle was not provided). Example: "@USERNAME" */
export const HANDLE: string = "";

// Typography — same pairing as the reference: wide black grotesque + thin "alternates" lowercase
export const FONT_HEAD = "Unbounded";           // weight 900, CAPS
export const FONT_LIGHT = "Montserrat Alternates"; // weight 300, lowercase
export const FONT_TAG = "Bebas Neue";

export const WHITE = "#F5F1E8";   // slightly warm white, as in the reference
export const ACCENT = "#E8562A";  // picked from the speaker's jacket — the only accent colour
export const INK = "#14161B";

// Social-media safe area (px): keep important text inside
export const SAFE = { top: 250, bottom: 420, side: 70 };

export const sec = (s: number) => Math.round(s * FPS);
