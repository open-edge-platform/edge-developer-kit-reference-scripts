/**
 * Local Lingua — Session epoch
 *
 * Incremented whenever the user clears history. Long requests (transcription of a
 * file can take a minute) capture the epoch when they start and check it before
 * touching the UI: if the user cleared history in the meantime, the response is
 * stale and must not repopulate anything.
 *
 * Without this, a request already in flight when Clear ran would come back and
 * re-add its chat bubble, its sentiment card and its hotwords — which for hotwords
 * is permanent, because detections live only in the browser (localStorage) and
 * there is no server copy to reconcile against on the next load.
 *
 * Lives in its own module because audio.js already imports from app.js; putting
 * the epoch in app.js would make the dependency circular.
 */

let _epoch = 0;

/** Epoch to stamp a request with before it starts. */
export function currentEpoch() {
  return _epoch;
}

/** Invalidate every in-flight request. Call after history has been cleared. */
export function bumpEpoch() {
  _epoch += 1;
  return _epoch;
}

/** True if history was cleared since `epoch` was captured. */
export function isStale(epoch) {
  return epoch !== _epoch;
}
