// Names of what the app keeps on this device (IndexedDB). The demo page (demo.html) sets a scope so its
// notes, offline copies and unfinished uploads stay apart from a member's own, and from other demo tabs.

let suffix = "";

export function setStorageScope(scope) {
  suffix = scope ? `--${scope}` : "";
}

export function scopedName(name) {
  return `${name}${suffix}`;
}
