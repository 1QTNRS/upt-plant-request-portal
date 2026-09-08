/** iOS photo-library usage string. Must match app.json expo-image-picker photosPermission. */
export const PHOTO_LIBRARY_PERMISSION =
  "Allow access to your photo library so you can upload photos to requests.";

/**
 * Intended NSCameraUsageDescription when a built-in camera/photo editor ships.
 * Do not add this to app.json or request Camera permission until the app
 * actually opens the camera.
 */
export const FUTURE_CAMERA_PERMISSION =
  "Allow camera access so you can take plant photos for requests.";
