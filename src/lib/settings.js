import { get } from './api.js';
// Public store settings are needed by several components; fetch them once per page load.
let promise = null;
export function loadStoreSettings(force = false) {
  if (!promise || force) promise = get('/public/settings').catch(() => ({}));
  return promise;
}
