// Names of what the app keeps on this device (IndexedDB). A page can set a scope so its notes, offline copies
// and unfinished uploads stay apart from a member's own.

let suffix = "";

export function setStorageScope(scope) {
  suffix = scope ? `--${scope}` : "";
}

export function scopedName(name) {
  return `${name}${suffix}`;
}
