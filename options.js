const DEFAULT_SYNC_SETTINGS = {
  defaultCaptureMode: "fullPage",
  defaultOutputTarget: "clipboard",
  showSuccessToast: true
};

const DEFAULT_LOCAL_STATE = {
  successfulCaptureCount: 0,
  donationPromptsDisabled: false
};

const settingsForm = document.getElementById("settings-form");
const defaultCaptureModeField = document.getElementById("default-capture-mode");
const defaultOutputTargetField = document.getElementById("default-output-target");
const showSuccessToastField = document.getElementById("show-success-toast");
const showSupportPromptsField = document.getElementById("show-support-prompts");
const captureCountLabel = document.getElementById("capture-count");
const saveState = document.getElementById("save-state");
const supportButton = document.getElementById("support-button");

async function loadSettings() {
  const syncSettings = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  const localState = await chrome.storage.local.get(DEFAULT_LOCAL_STATE);

  defaultCaptureModeField.value = syncSettings.defaultCaptureMode;
  defaultOutputTargetField.value = syncSettings.defaultOutputTarget;
  showSuccessToastField.checked = Boolean(syncSettings.showSuccessToast);
  showSupportPromptsField.checked = !localState.donationPromptsDisabled;
  captureCountLabel.textContent = String(localState.successfulCaptureCount);
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    defaultCaptureMode: defaultCaptureModeField.value,
    defaultOutputTarget: defaultOutputTargetField.value,
    showSuccessToast: showSuccessToastField.checked
  });

  await chrome.storage.local.set({
    donationPromptsDisabled: !showSupportPromptsField.checked
  });

  saveState.textContent = "Settings saved";
  window.setTimeout(() => {
    saveState.textContent = "";
  }, 1800);
});

supportButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "scrollshot-open-support" });
});

void loadSettings();
