/**
 * All configuration options: https://remotion.dev/docs/config
 */
import { Config } from "@remotion/cli/config";
import fs from "node:fs";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(96);
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);

// Use an already-installed headless Chrome when present (cloud container); otherwise Remotion downloads its own.
const localChrome =
  process.env.REMOTION_CHROME ??
  "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
if (fs.existsSync(localChrome)) {
  Config.setBrowserExecutable(localChrome);
}
