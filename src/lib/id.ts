let counter = 0;

/** Short unique id, stable enough for local records (not cryptographic). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
