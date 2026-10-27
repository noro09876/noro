import '@fontsource-variable/unbounded/index.css';
import '@fontsource-variable/onest/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';

const FAMILIES = ["600 40px 'Unbounded Variable'", "500 40px 'Onest Variable'", "400 40px 'JetBrains Mono'"];

/** Blocks rendering until the brand fonts (incl. Cyrillic subsets) are loaded. */
export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    const sample = 'Контент NORO 0123';
    Promise.all(FAMILIES.map((f) => document.fonts.load(f, sample)))
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .finally(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
};
