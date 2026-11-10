import { continueRender, delayRender, staticFile } from "remotion";

const faces: [string, string, string][] = [
  ["Unbounded", "fonts/Unbounded-VF.ttf", "200 900"],
  ["Montserrat Alternates", "fonts/MontserratAlternates-ExtraLight.ttf", "200"],
  ["Montserrat Alternates", "fonts/MontserratAlternates-Light.ttf", "300"],
  ["Montserrat Alternates", "fonts/MontserratAlternates-Regular.ttf", "400"],
  ["Montserrat Alternates", "fonts/MontserratAlternates-Medium.ttf", "500"],
  ["Bebas Neue", "fonts/BebasNeue-Regular.ttf", "400"],
];

let started = false;
export const ensureFonts = () => {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("fonts");
  Promise.all(
    faces.map(([family, file, weight]) => {
      const f = new FontFace(family, `url(${staticFile(file)})`, { weight });
      return f.load().then((l) => document.fonts.add(l));
    }),
  ).then(() => continueRender(handle));
};
