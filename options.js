const { DEFAULT_SYNC_SETTINGS, DEFAULT_LOCAL_STATE, SHORTCUT_LABEL } = window.TallsnapShared;

const settingsForm = document.getElementById("settings-form");
const languagePreferenceField = document.getElementById("language-preference");
const defaultCaptureModeField = document.getElementById("default-capture-mode");
const defaultOutputTargetField = document.getElementById("default-output-target");
const defaultOutputFormatField = document.getElementById("default-output-format");
const defaultFilenamePresetField = document.getElementById("default-filename-preset");
const showSuccessToastField = document.getElementById("show-success-toast");
const defaultCleanupEnabledField = document.getElementById("default-cleanup-enabled");
const cleanupStickyField = document.getElementById("cleanup-sticky");
const cleanupCookiesField = document.getElementById("cleanup-cookies");
const cleanupChatField = document.getElementById("cleanup-chat");
const cleanupOverlaysField = document.getElementById("cleanup-overlays");
const showSupportPromptsField = document.getElementById("show-support-prompts");
const captureCountLabel = document.getElementById("capture-count");
const saveState = document.getElementById("save-state");
const supportButton = document.getElementById("support-button");
const shortcutLine = document.getElementById("shortcut-line");
const shortcutHint = document.getElementById("shortcut-hint");

function applyLocalizedText() {
  window.TallsnapI18n.apply();
  document.title = window.TallsnapI18n.t("settings_page_title");
  shortcutLine.textContent = window.TallsnapI18n.t("quick_actions_shortcut", SHORTCUT_LABEL);
  shortcutHint.textContent = window.TallsnapI18n.t("quick_actions_shortcut_hint");
}

async function loadSettings() {
  await window.TallsnapI18n.init();
  applyLocalizedText();

  const syncSettings = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  const localState = await chrome.storage.local.get(DEFAULT_LOCAL_STATE);

  languagePreferenceField.value = syncSettings.languagePreference;
  defaultCaptureModeField.value = syncSettings.defaultCaptureMode;
  defaultOutputTargetField.value = syncSettings.defaultOutputTarget;
  defaultOutputFormatField.value = syncSettings.defaultOutputFormat;
  defaultFilenamePresetField.value = syncSettings.defaultFilenamePreset;
  showSuccessToastField.checked = Boolean(syncSettings.showSuccessToast);
  defaultCleanupEnabledField.checked = Boolean(syncSettings.defaultCleanupEnabled);
  cleanupStickyField.checked = Boolean(syncSettings.cleanupSticky);
  cleanupCookiesField.checked = Boolean(syncSettings.cleanupCookies);
  cleanupChatField.checked = Boolean(syncSettings.cleanupChat);
  cleanupOverlaysField.checked = Boolean(syncSettings.cleanupOverlays);
  showSupportPromptsField.checked = !localState.donationPromptsDisabled;
  captureCountLabel.textContent = String(localState.successfulCaptureCount);
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    languagePreference: languagePreferenceField.value,
    defaultCaptureMode: defaultCaptureModeField.value,
    defaultOutputTarget: defaultOutputTargetField.value,
    defaultOutputFormat: defaultOutputFormatField.value,
    defaultFilenamePreset: defaultFilenamePresetField.value,
    showSuccessToast: showSuccessToastField.checked,
    defaultCleanupEnabled: defaultCleanupEnabledField.checked,
    cleanupSticky: cleanupStickyField.checked,
    cleanupCookies: cleanupCookiesField.checked,
    cleanupChat: cleanupChatField.checked,
    cleanupOverlays: cleanupOverlaysField.checked
  });

  await chrome.storage.local.set({
    donationPromptsDisabled: !showSupportPromptsField.checked
  });

  await loadSettings();
  saveState.textContent = window.TallsnapI18n.t("settings_saved");
  window.setTimeout(() => {
    saveState.textContent = "";
  }, 1800);
});

supportButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "tallsnap-open-support" });
});

void loadSettings();
