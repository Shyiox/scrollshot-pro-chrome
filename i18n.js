(function attachTallsnapI18n(globalScope) {
  const SUPPORTED_LOCALES = ["en", "de"];
  const STORAGE_DEFAULTS = { languagePreference: "auto" };
  let cachedPreference = null;
  let cachedLocale = "en";
  let cachedMessages = null;

  function normalizeLocale(locale) {
    if (!locale) {
      return "en";
    }

    const normalized = locale.toLowerCase();
    if (normalized.startsWith("de")) {
      return "de";
    }

    return "en";
  }

  async function loadMessageBundle(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return null;
    }

    const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
    if (!response.ok) {
      throw new Error(`Could not load locale bundle for ${locale}.`);
    }

    return response.json();
  }

  function applySubstitutions(message, substitutions) {
    if (!Array.isArray(substitutions)) {
      substitutions = substitutions === undefined ? [] : [substitutions];
    }

    return message.replace(/\$(\d+)/g, (_, index) => substitutions[Number(index) - 1] ?? "");
  }

  function getMessageFromBundle(key, substitutions) {
    const message = cachedMessages?.[key]?.message;
    if (!message) {
      return "";
    }

    return applySubstitutions(message, substitutions);
  }

  async function init(force = false) {
    const { languagePreference } = await chrome.storage.sync.get(STORAGE_DEFAULTS);
    const resolvedPreference = languagePreference || "auto";
    const locale =
      resolvedPreference === "auto"
        ? normalizeLocale(chrome.i18n.getUILanguage())
        : normalizeLocale(resolvedPreference);

    if (!force && cachedPreference === resolvedPreference && cachedLocale === locale) {
      if (typeof document !== "undefined") {
        document.documentElement.lang = locale;
      }

      return api;
    }

    cachedPreference = resolvedPreference;
    cachedLocale = locale;
    cachedMessages = resolvedPreference === "auto" ? null : await loadMessageBundle(locale);

    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }

    return api;
  }

  function t(key, substitutions) {
    const bundledMessage = getMessageFromBundle(key, substitutions);
    if (bundledMessage) {
      return bundledMessage;
    }

    const chromeMessage = chrome.i18n.getMessage(key, substitutions);
    if (chromeMessage) {
      return chromeMessage;
    }

    return key;
  }

  function apply(root = typeof document !== "undefined" ? document : null) {
    if (!root) {
      return;
    }

    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.dataset.i18nTitle));
    });
  }

  const api = {
    init,
    t,
    apply,
    getLocale: () => cachedLocale,
    normalizeLocale
  };

  globalScope.TallsnapI18n = api;
})(typeof self !== "undefined" ? self : window);
