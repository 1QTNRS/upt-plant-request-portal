export const APP_INTRO_BACKGROUND = "#002910";
export const APP_INTRO_DURATION_MS = 1100;
export const APP_INTRO_REDUCED_MOTION_MS = 0;
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
  return input.sessionKind === "fresh";
}

export function appIntroDurationMs(reduceMotion: boolean): number {
  return reduceMotion ? APP_INTRO_REDUCED_MOTION_MS : APP_INTRO_DURATION_MS;
}
