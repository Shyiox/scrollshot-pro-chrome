const CAPTURE_SETTLE_DELAY_MS = 175;
const MIN_CAPTURE_INTERVAL_MS = 650;
const BADGE_COLOR = "#155EEF";

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

async function stitchAndCopy(tabId, payload) {
  const pngDataUrl = await stitchCaptures(payload);
  const copyResponse = await sendTabMessage(tabId, {
    type: "scrollshot-copy-image",
    dataUrl: pngDataUrl
  });

  if (copyResponse?.ok) {
    return;
  }

  throw new Error(
    copyResponse?.error ||
    "Das Bild konnte im aktiven Tab nicht in die Zwischenablage kopiert werden."
  );
}

async function runScrollShot() {
  const tab = await getActiveTab();
  await ensureCaptureScript(tab.id);

  await setBadge("...");

  try {
    const stitchedPayload = await captureSlices(tab);
    await stitchAndCopy(tab.id, stitchedPayload);

    await setBadge("OK");
    notify("Fertig", "Der komplette Scrollshot ist jetzt in der Zwischenablage.");
    await wait(1200);
  } finally {
    await clearBadge();
  }
}

function triggerCapture() {
  void runScrollShot().catch(async (error) => {
    await clearBadge();
    notify("Fehler", error instanceof Error ? error.message : String(error));
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "scroll-shot") {
    triggerCapture();
  }
});

chrome.action.onClicked.addListener(() => {
  triggerCapture();
});
