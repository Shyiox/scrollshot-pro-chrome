(function attachTallsnapShared(globalScope) {
  globalScope.TallsnapShared = {
    BRAND_NAME: "Tallsnap",
    SHORTCUT_LABEL: "Ctrl+Shift+S",
    SUPPORT_URL: "https://paypal.me/Shyiox",
    DEFAULT_SYNC_SETTINGS: {
      languagePreference: "auto",
      defaultCaptureMode: "fullPage",
      defaultOutputTarget: "clipboard",
      defaultOutputFormat: "png",
      defaultFilenamePreset: "title-date",
      showSuccessToast: true,
      defaultCleanupEnabled: true,
      cleanupSticky: true,
      cleanupCookies: true,
      cleanupChat: true,
      cleanupOverlays: false
    },
    DEFAULT_LOCAL_STATE: {
      successfulCaptureCount: 0,
      lastDonationPromptAtCount: 0,
      donationPromptsDisabled: false
    },
    CAPTURE_MODES: ["fullPage", "visibleArea", "element"],
    OUTPUT_TARGETS: ["clipboard", "download"],
    OUTPUT_FORMATS: ["png", "jpg", "pdf"],
    FILENAME_PRESETS: ["title-date", "domain-date", "timestamp"],
    CLEANUP_KEYS: ["cleanupSticky", "cleanupCookies", "cleanupChat", "cleanupOverlays"]
  };
})(typeof self !== "undefined" ? self : window);
