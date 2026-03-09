const actionButtons = [...document.querySelectorAll(".action-card")];
const statusMessage = document.getElementById("status-message");
const supportLink = document.getElementById("support-link");
const openSettingsButton = document.getElementById("open-settings");

function setBusyState(isBusy) {
  for (const button of actionButtons) {
    button.disabled = isBusy;
  }
}

async function runCapture(button) {
  setBusyState(true);
  statusMessage.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "scrollshot-run",
      captureMode: button.dataset.captureMode,
      outputTarget: button.dataset.outputTarget
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The screenshot could not be created.");
    }

    window.close();
  } catch (error) {
    statusMessage.textContent = error instanceof Error ? error.message : String(error);
    setBusyState(false);
  }
}

for (const button of actionButtons) {
  button.addEventListener("click", () => {
    void runCapture(button);
  });
}

supportLink.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "scrollshot-open-support" });
  window.close();
});

openSettingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});
