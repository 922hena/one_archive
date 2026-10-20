import ko from "./locales/ko.js";

const FALLBACK_LOCALE = "ko";
const dictionaries = { ko };
let currentLocale = FALLBACK_LOCALE;

function lookup(dictionary, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), dictionary);
}

export function registerLocale(code, dictionary) {
  dictionaries[code] = dictionary;
}

export function setLocale(code) {
  if (dictionaries[code]) currentLocale = code;
  if (typeof document !== "undefined") document.documentElement.lang = currentLocale;
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export function hasKey(key) {
  return typeof lookup(dictionaries[FALLBACK_LOCALE], key) === "string";
}

export function t(key, params = {}) {
  let text = lookup(dictionaries[currentLocale], key);
  if (typeof text !== "string") text = lookup(dictionaries[FALLBACK_LOCALE], key);
  if (typeof text !== "string") return key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function translateDom(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-i18n-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel));
  });
}
