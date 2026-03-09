const CAPTURE_SETTLE_DELAY_MS = 175;
const MIN_CAPTURE_INTERVAL_MS = 650;
const BADGE_COLOR = "#155EEF";
const SUPPORT_URL = "https://paypal.me/Shyiox";
const DONATION_FIRST_PROMPT_COUNT = 15;
const DONATION_REPEAT_INTERVAL = 30;

const DEFAULT_SYNC_SETTINGS = {
  defaultCaptureMode: "fullPage",
  defaultOutputTarget: "clipboard",
  showSuccessToast: true
};

const DEFAULT_LOCAL_STATE = {
  successfulCaptureCount: 0,
  lastDonationPromptAtCount: 0,
  donationPromptsDisabled: false
};

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title,
    message,
    priority: 2
  });
}

function isCapturablePage(url) {
  return typeof url === "string" && /^(https?:\/\/|file:\/\/)/i.test(url);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setBadge(text) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text });
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
}

async function getDonationState() {
  return chrome.storage.local.get(DEFAULT_LOCAL_STATE);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("Kein aktiver Tab gefunden.");
  }

  if (!isCapturablePage(tab.url)) {
    throw new Error("Diese Seite kann nicht aufgenommen werden. Nutze eine normale Webseite mit http(s) oder file://.");
  }

  return tab;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

async function ensureCaptureScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page_capture.js"]
  });
}

async function captureSlices(tab) {
  const initResponse = await sendTabMessage(tab.id, { type: "scrollshot-start" });
  if (!initResponse?.ok) {
    throw new Error(initResponse?.error || "Die Seite konnte nicht vorbereitet werden.");
  }

  const { plan } = initResponse;
  const captures = [];
  let lastCaptureAt = 0;

  try {
    for (let index = 0; index < plan.segments.length; index += 1) {
      const segment = plan.segments[index];
      await setBadge(String(index + 1));

      const scrollResponse = await sendTabMessage(tab.id, {
        type: "scrollshot-scroll",
        scrollY: segment.scrollY
      });

      if (!scrollResponse?.ok) {
        throw new Error(scrollResponse?.error || "Die Seite konnte nicht gescrollt werden.");
      }

      await wait(CAPTURE_SETTLE_DELAY_MS);

      const elapsedSinceLastCapture = Date.now() - lastCaptureAt;
      if (elapsedSinceLastCapture < MIN_CAPTURE_INTERVAL_MS) {
        await wait(MIN_CAPTURE_INTERVAL_MS - elapsedSinceLastCapture);
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png"
      });
      lastCaptureAt = Date.now();

      captures.push({
        scrollY: segment.scrollY,
        sourceY: segment.sourceY,
        destY: segment.destY,
        height: segment.height,
        dataUrl
      });
    }
  } finally {
    await sendTabMessage(tab.id, { type: "scrollshot-finish" }).catch(() => {});
  }

  return {
    pageWidth: plan.pageWidth,
    pageHeight: plan.pageHeight,
    viewportWidth: plan.viewportWidth,
    captures
  };
}

async function bitmapFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function buildTimestampFilename() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `scrollshot-${valueByType.year}-${valueByType.month}-${valueByType.day}-${valueByType.hour}-${valueByType.minute}-${valueByType.second}.png`;
}

async function stitchCaptures(payload) {
  const { pageWidth, pageHeight, viewportWidth, captures } = payload;

  if (!captures?.length) {
    throw new Error("Es wurden keine Screenshot-Segmente empfangen.");
  }

  const firstBitmap = await bitmapFromDataUrl(captures[0].dataUrl);
  const scale = firstBitmap.width / viewportWidth;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(pageWidth * scale)),
    Math.max(1, Math.round(pageHeight * scale))
  );
  const context = canvas.getContext("2d");

  if (!context) {
    firstBitmap.close();
    throw new Error("Canvas-Kontext konnte nicht erstellt werden.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const capture of captures) {
    const bitmap = capture === captures[0] ? firstBitmap : await bitmapFromDataUrl(capture.dataUrl);

    try {
      const sourceY = Math.round(capture.sourceY * scale);
      const sourceHeight = Math.round(capture.height * scale);
      const destY = Math.round(capture.destY * scale);

      context.drawImage(
        bitmap,
        0,
        sourceY,
        bitmap.width,
        sourceHeight,
        0,
        destY,
        canvas.width,
        sourceHeight
      );
    } finally {
      bitmap.close();
    }
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function copyImageToClipboard(tabId, dataUrl) {
  const copyResponse = await sendTabMessage(tabId, {
    type: "scrollshot-copy-image",
    dataUrl
  });

  if (copyResponse?.ok) {
    return;
  }

  throw new Error(
    copyResponse?.error ||
    "Das Bild konnte im aktiven Tab nicht in die Zwischenablage kopiert werden."
  );
}

async function downloadImage(dataUrl) {
  await chrome.downloads.download({
    url: dataUrl,
    filename: buildTimestampFilename(),
    saveAs: false
  });
}

async function sendToast(tabId, payload) {
  const response = await sendTabMessage(tabId, {
    type: "scrollshot-show-toast",
    ...payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Der Hinweis konnte nicht angezeigt werden.");
  }
}

async function recordSuccessfulCapture() {
  const donationState = await getDonationState();
  const successfulCaptureCount = donationState.successfulCaptureCount + 1;

  await chrome.storage.local.set({ successfulCaptureCount });

  if (donationState.donationPromptsDisabled) {
    return { successfulCaptureCount, shouldPromptDonation: false };
  }

  const shouldPromptFirstTime =
    successfulCaptureCount >= DONATION_FIRST_PROMPT_COUNT &&
    donationState.lastDonationPromptAtCount < DONATION_FIRST_PROMPT_COUNT;
  const shouldPromptRepeat =
    donationState.lastDonationPromptAtCount >= DONATION_FIRST_PROMPT_COUNT &&
    successfulCaptureCount - donationState.lastDonationPromptAtCount >= DONATION_REPEAT_INTERVAL;

  const shouldPromptDonation = shouldPromptFirstTime || shouldPromptRepeat;

  if (shouldPromptDonation) {
    await chrome.storage.local.set({ lastDonationPromptAtCount: successfulCaptureCount });
  }

  return { successfulCaptureCount, shouldPromptDonation };
}

async function runCaptureForMode(tab, request) {
  if (request.captureMode === "visibleArea") {
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  }

  const stitchedPayload = await captureSlices(tab);
  return stitchCaptures(stitchedPayload);
}

async function showPostCaptureToasts(tabId, outputTarget) {
  const settings = await getSettings();
  const { shouldPromptDonation } = await recordSuccessfulCapture();

  if (settings.showSuccessToast) {
    await sendToast(tabId, {
      title: "Scrollshot Pro",
      message: outputTarget === "download" ? "Saved as PNG" : "Copied to clipboard",
      variant: "success"
    });
  }

  if (shouldPromptDonation) {
    await sendToast(tabId, {
      title: "Enjoying Scrollshot Pro?",
      message: "You can support development via PayPal.",
      variant: "support"
    });
  }
}

async function runScrollShot(request = null) {
  const settings = await getSettings();
  const tab = await getActiveTab();
  const effectiveRequest = request || {
    captureMode: settings.defaultCaptureMode,
    outputTarget: settings.defaultOutputTarget
  };

  await ensureCaptureScript(tab.id);
  await setBadge("...");

  try {
    const imageDataUrl = await runCaptureForMode(tab, effectiveRequest);

    if (effectiveRequest.outputTarget === "download") {
      await downloadImage(imageDataUrl);
    } else {
      await copyImageToClipboard(tab.id, imageDataUrl);
    }

    await setBadge("OK");
    await showPostCaptureToasts(tab.id, effectiveRequest.outputTarget);
    await wait(900);
  } finally {
    await clearBadge();
  }
}

function triggerCapture(request = null) {
  return runScrollShot(request).catch(async (error) => {
    await clearBadge();
    notify("Fehler", error instanceof Error ? error.message : String(error));
    throw error;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "scrollshot-run") {
    void triggerCapture({
      captureMode: message.captureMode,
      outputTarget: message.outputTarget
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "scrollshot-open-support") {
    void chrome.tabs.create({ url: SUPPORT_URL })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "scroll-shot") {
    void triggerCapture();
  }
});
