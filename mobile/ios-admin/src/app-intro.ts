export const APP_INTRO_BACKGROUND = "#002910";
/** Long enough to read the store mark. A 1.1s hold felt like a flash. */
export const APP_INTRO_DURATION_MS = 2200;
/** Reduce Motion still holds the logo; it only skips the scale. */
export const APP_INTRO_REDUCED_MOTION_MS = 2000;
export const APP_INTRO_SCALE_MS = 800;
/** Matches the native splash `imageWidth` so both frames use the same mark. */
export const APP_INTRO_LOGO_WIDTH = 260;
export const APP_INTRO_SPLASH_IMAGE = "./assets/splash-icon.png";
/** Logo is visible immediately. Only scale animates so there is no empty-green frame. */
export const APP_INTRO_START_OPACITY = 1;
export const APP_INTRO_START_SCALE = 0.96;

export function appIntroShowsLogoBeforeAnimation(): boolean {
  return APP_INTRO_START_OPACITY >= 1;
}

export function shouldPlayAppIntro(input: {
  sessionKind: "unknown" | "restore" | "fresh";
}): boolean {
  return input.sessionKind === "fresh" || input.sessionKind === "restore";
}

export function appIntroDurationMs(reduceMotion: boolean): number {
  return reduceMotion ? APP_INTRO_REDUCED_MOTION_MS : APP_INTRO_DURATION_MS;
}
