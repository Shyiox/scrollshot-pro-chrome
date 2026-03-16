const { DEFAULT_SYNC_SETTINGS, SHORTCUT_LABEL } = window.TallsnapShared;

const modeButtons = [...document.querySelectorAll(".mode-card")];
const actionButtons = [...document.querySelectorAll(".action-button")];
const cleanupEnabledField = document.getElementById("cleanup-enabled");
const statusMessage = document.getElementById("status-message");
const supportLink = document.getElementById("support-link");
const openSettingsButton = document.getElementById("open-settings");
const shortcutLine = document.getElementById("shortcut-line");
const shortcutDefaultLine = document.getElementById("shortcut-default-line");
const outputFormatField = document.getElementById("output-format");
const filenamePresetField = document.getElementById("filename-preset");

let selectedCaptureMode = DEFAULT_SYNC_SETTINGS.defaultCaptureMode;

function setBusyState(isBusy) {
  for (const button of [...modeButtons, ...actionButtons]) {
    button.disabled = isBusy;
  }

  cleanupEnabledField.disabled = isBusy;
  outputFormatField.disabled = isBusy;
  filenamePresetField.disabled = isBusy;
}

function translateCaptureMode(value) {
  if (value === "visibleArea") {
    return window.TallsnapI18n.t("popup_what_i_see");
  }

  if (value === "element") {
    return window.TallsnapI18n.t("popup_element");
  }

  return window.TallsnapI18n.t("popup_whole_page");
}

function translateOutputTarget(value) {
  return window.TallsnapI18n.t(value === "download" ? "popup_save" : "popup_copy");
}

function renderShortcutSummary(settings) {
  shortcutLine.textContent = window.TallsnapI18n.t("popup_shortcut_label", SHORTCUT_LABEL);
  shortcutDefaultLine.textContent = window.TallsnapI18n.t(
    "popup_shortcut_default",
    `${translateCaptureMode(settings.defaultCaptureMode)} -> ${translateOutputTarget(settings.defaultOutputTarget)}`
  );
}

function applySelectedMode(mode) {
  selectedCaptureMode = mode;

  for (const button of modeButtons) {
    button.dataset.selected = String(button.dataset.captureMode === mode);
  }
}

async function initializePopup() {
  await window.TallsnapI18n.init();
  window.TallsnapI18n.apply();

  document.title = window.TallsnapI18n.t("popup_page_title");

  const settings = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  outputFormatField.value = settings.defaultOutputFormat;
  filenamePresetField.value = settings.defaultFilenamePreset;
  cleanupEnabledField.checked = Boolean(settings.defaultCleanupEnabled);
  applySelectedMode(settings.defaultCaptureMode);
  renderShortcutSummary(settings);
}

async function runCapture(outputTarget) {
  setBusyState(true);
  statusMessage.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "tallsnap-run",
      captureMode: selectedCaptureMode,
      outputTarget,
      outputFormat: outputFormatField.value,
      filenamePreset: filenamePresetField.value,
      cleanupEnabled: cleanupEnabledField.checked
    });

    if (!response?.ok) {
      throw new Error(response?.error || window.TallsnapI18n.t("status_generic_failure"));
    }

    window.close();
  } catch (error) {
    statusMessage.textContent = error instanceof Error ? error.message : String(error);
    setBusyState(false);
  }
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    applySelectedMode(button.dataset.captureMode);
  });
}

for (const button of actionButtons) {
  button.addEventListener("click", () => {
    void runCapture(button.dataset.outputTarget);
  });
}

supportLink.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "tallsnap-open-support" });
  window.close();
});

openSettingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

void initializePopup();
