/**
 * Shared caps for the customer request form. Kept out of `customer-portal.ts`
 * so the request-form component can read them without pulling `node:crypto`
 * (via the app-proxy helpers) into the browser bundle.
 */
export const MAX_PLANT_ROWS = 20;

/** Anything longer than this is a paste accident, and it has to fit in a URL. */
export const MAX_NOTE_LENGTH = 500;
export const MAX_PLANT_NAME_LENGTH = 120;
