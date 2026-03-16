importScripts("shared.js", "i18n.js");

const { DEFAULT_SYNC_SETTINGS, DEFAULT_LOCAL_STATE, SUPPORT_URL } = self.TallsnapShared;

const CAPTURE_SETTLE_DELAY_MS = 175;
const MIN_CAPTURE_INTERVAL_MS = 650;
const BADGE_COLOR = "#C98655";
const DONATION_FIRST_PROMPT_COUNT = 15;
const DONATION_REPEAT_INTERVAL = 30;
const USER_CANCELLED_ERROR = "TALLSNAP_CANCELLED";

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title,
    message,
    priority: 2
  });
}

async function getI18n() {
  await self.TallsnapI18n.init();
  return self.TallsnapI18n;
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

async function getActiveTab(i18n) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error(i18n.t("error_no_active_tab"));
  }

  if (!isCapturablePage(tab.url)) {
    throw new Error(i18n.t("error_unsupported_page"));
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

function isCancellationError(error) {
  return error instanceof Error && error.name === USER_CANCELLED_ERROR;
}

function buildCancellationError() {
  const error = new Error(USER_CANCELLED_ERROR);
  error.name = USER_CANCELLED_ERROR;
  return error;
}

function buildCleanupConfig(settings, request) {
  const enabled = request?.cleanupEnabled ?? settings.defaultCleanupEnabled;

  return {
    enabled,
    sticky: enabled && Boolean(settings.cleanupSticky),
    cookies: enabled && Boolean(settings.cleanupCookies),
    chat: enabled && Boolean(settings.cleanupChat),
    overlays: enabled && Boolean(settings.cleanupOverlays)
  };
}

async function prepareVisibleCapture(tabId, cleanupConfig, preserveSelectedElement, i18n) {
  const response = await sendTabMessage(tabId, {
    type: "tallsnap-prepare-visible",
    cleanupConfig,
    preserveSelectedElement
  });

  if (!response?.ok) {
    throw new Error(response?.error || i18n.t("error_prepare_page"));
  }

  return response.metrics;
}

async function finishCapture(tabId) {
  await sendTabMessage(tabId, { type: "tallsnap-finish" }).catch(() => {});
}

async function captureSlices(tab, i18n, cleanupConfig, preserveSelectedElement = false) {
  const initResponse = await sendTabMessage(tab.id, {
    type: "tallsnap-start-capture",
    cleanupConfig,
    preserveSelectedElement
  });

  if (!initResponse?.ok) {
    throw new Error(initResponse?.error || i18n.t("error_prepare_page"));
  }

  const { plan } = initResponse;
  const captures = [];
  let lastCaptureAt = 0;

  try {
    for (let index = 0; index < plan.segments.length; index += 1) {
      const segment = plan.segments[index];
      await setBadge(String(index + 1));

      const scrollResponse = await sendTabMessage(tab.id, {
        type: "tallsnap-scroll",
        scrollY: segment.scrollY
      });

      if (!scrollResponse?.ok) {
        throw new Error(scrollResponse?.error || i18n.t("error_scroll_page"));
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
        sourceY: segment.sourceY,
        destY: segment.destY,
        height: segment.height,
        dataUrl
      });
    }
  } finally {
    await finishCapture(tab.id);
  }

  return {
    pageWidth: plan.pageWidth,
    pageHeight: plan.pageHeight,
    viewportWidth: plan.viewportWidth,
    viewportHeight: plan.viewportHeight,
    captures
  };
}

async function bitmapFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function imageDataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function stitchCaptures(payload, i18n) {
  const { pageWidth, pageHeight, viewportWidth, captures } = payload;

  if (!captures?.length) {
    throw new Error(i18n.t("error_no_segments"));
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
    throw new Error(i18n.t("error_canvas_context"));
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

  return {
    blob: await canvas.convertToBlob({ type: "image/png" }),
    pageWidth,
    pageHeight,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height
  };
}

async function cropBlobToRect(blob, rect, baseSize, i18n) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(rect.width * (bitmap.width / baseSize.width))),
    Math.max(1, Math.round(rect.height * (bitmap.height / baseSize.height)))
  );
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error(i18n.t("error_canvas_context"));
  }

  const scaleX = bitmap.width / baseSize.width;
  const scaleY = bitmap.height / baseSize.height;
  const sourceX = Math.max(0, Math.round(rect.left * scaleX));
  const sourceY = Math.max(0, Math.round(rect.top * scaleY));
  const sourceWidth = Math.min(bitmap.width - sourceX, Math.max(1, Math.round(rect.width * scaleX)));
  const sourceHeight = Math.min(bitmap.height - sourceY, Math.max(1, Math.round(rect.height * scaleY)));

  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/png" });
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

async function convertPngBlobToJpegBlob(blob, i18n) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error(i18n.t("error_canvas_context"));
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function buildPdfBlob(jpegBytes, imageWidth, imageHeight) {
  const pageWidth = Math.max(1, Math.round(imageWidth * 0.75));
  const pageHeight = Math.max(1, Math.round(imageHeight * 0.75));
  const contentStream = encodeText(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
  const chunks = [];
  const offsets = [0];
  let position = 0;

  function push(chunk) {
    const bytes = typeof chunk === "string" ? encodeText(chunk) : chunk;
    chunks.push(bytes);
    position += bytes.length;
  }

  push("%PDF-1.4\n");
  offsets[1] = position;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = position;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offsets[3] = position;
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );
  offsets[4] = position;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  push(jpegBytes);
  push("\nendstream\nendobj\n");
  offsets[5] = position;
  push(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n`);
  push(contentStream);
  push("endstream\nendobj\n");

  const xrefOffset = position;
  push("xref\n0 6\n0000000000 65535 f \n");

  for (let index = 1; index <= 5; index += 1) {
    push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }

  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob([concatChunks(chunks)], { type: "application/pdf" });
}

async function convertPngBlobToPdfBlob(blob, i18n) {
  try {
    const bitmap = await createImageBitmap(blob);
    const jpegBlob = await convertPngBlobToJpegBlob(blob, i18n);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const pdfBlob = buildPdfBlob(jpegBytes, bitmap.width, bitmap.height);
    bitmap.close();
    return pdfBlob;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : i18n.t("error_pdf"));
  }
}

async function convertForDownload(pngBlob, outputFormat, i18n) {
  if (outputFormat === "jpg") {
    return {
      blob: await convertPngBlobToJpegBlob(pngBlob, i18n),
      extension: "jpg"
    };
  }

  if (outputFormat === "pdf") {
    return {
      blob: await convertPngBlobToPdfBlob(pngBlob, i18n),
      extension: "pdf"
    };
  }

  return {
    blob: pngBlob,
    extension: "png"
  };
}

function buildTimestampParts() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function sanitizeFilenamePart(value) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildDownloadFilename(tab, preset, extension) {
  const parts = buildTimestampParts();
  const stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}`;
  const hostname = (() => {
    try {
      return new URL(tab.url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  })();

  const pageTitle = sanitizeFilenamePart(tab.title);
  const domain = sanitizeFilenamePart(hostname);
  let baseName = "tallsnap";

  if (preset === "title-date" && pageTitle) {
    baseName = `${pageTitle}-${stamp}`;
  } else if (preset === "domain-date" && domain) {
    baseName = `${domain}-${stamp}`;
  } else if (preset === "timestamp") {
    baseName = `tallsnap-${stamp}`;
  } else if (domain) {
    baseName = `${domain}-${stamp}`;
  } else {
    baseName = `tallsnap-${stamp}`;
  }

  return `${baseName}.${extension}`;
}

async function copyImageToClipboard(tabId, pngBlob, i18n) {
  const copyResponse = await sendTabMessage(tabId, {
    type: "tallsnap-copy-image",
    dataUrl: await blobToDataUrl(pngBlob)
  });

  if (copyResponse?.ok) {
    return;
  }

  throw new Error(copyResponse?.error || i18n.t("error_clipboard"));
}

async function downloadBlob(blob, filename, i18n) {
  try {
    if (typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(blob);

      try {
        await chrome.downloads.download({
          url: objectUrl,
          filename,
          saveAs: false
        });
        return;
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    }

    await chrome.downloads.download({
      url: await blobToDataUrl(blob),
      filename,
      saveAs: false
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : i18n.t("error_download"));
  }
}

async function sendToast(tabId, payload, i18n) {
  const response = await sendTabMessage(tabId, {
    type: "tallsnap-show-toast",
    ...payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || i18n.t("error_toast"));
  }
}

async function recordSuccessfulCapture() {
  const donationState = await getDonationState();
  const successfulCaptureCount = donationState.successfulCaptureCount + 1;

  await chrome.storage.local.set({ successfulCaptureCount });

  if (donationState.donationPromptsDisabled) {
    return { shouldPromptDonation: false };
  }

  const shouldPromptFirstTime =
    successfulCaptureCount >= DONATION_FIRST_PROMPT_COUNT &&
    donationState.lastDonationPromptAtCount < DONATION_FIRST_PROMPT_COUNT;
  const shouldPromptRepeat =
    donationState.lastDonationPromptAtCount >= DONATION_FIRST_PROMPT_COUNT &&
    successfulCaptureCount - donationState.lastDonationPromptAtCount >= DONATION_REPEAT_INTERVAL;

  if (shouldPromptFirstTime || shouldPromptRepeat) {
    await chrome.storage.local.set({ lastDonationPromptAtCount: successfulCaptureCount });
    return { shouldPromptDonation: true };
  }

  return { shouldPromptDonation: false };
}

function successMessageKey(outputTarget, outputFormat) {
  if (outputTarget !== "download") {
    return "toast_copied";
  }

  if (outputFormat === "jpg") {
    return "toast_saved_jpg";
  }

  if (outputFormat === "pdf") {
    return "toast_saved_pdf";
  }

  return "toast_saved_png";
}

async function showPostCaptureToasts(tabId, outputTarget, outputFormat, i18n) {
  const settings = await getSettings();
  const { shouldPromptDonation } = await recordSuccessfulCapture();

  if (settings.showSuccessToast) {
    await sendToast(
      tabId,
      {
        title: i18n.t("toast_title_success"),
        message: i18n.t(successMessageKey(outputTarget, outputFormat)),
        variant: "success"
      },
      i18n
    );
  }

  if (shouldPromptDonation) {
    await sendToast(
      tabId,
      {
        title: i18n.t("toast_support_title"),
        message: i18n.t("toast_support_message"),
        variant: "support"
      },
      i18n
    );
  }
}

async function selectElement(tabId, i18n) {
  const response = await sendTabMessage(tabId, {
    type: "tallsnap-pick-element",
    title: i18n.t("picker_prompt_title"),
    message: i18n.t("picker_prompt_body"),
    cancelLabel: i18n.t("picker_cancel")
  });

  if (!response?.ok) {
    throw new Error(response?.error || i18n.t("error_pick_element"));
  }

  if (response.cancelled) {
    throw buildCancellationError();
  }

  if (!response.selection?.pageRect?.width || !response.selection?.pageRect?.height) {
    throw new Error(i18n.t("error_no_element"));
  }

  return response.selection;
}

async function captureVisibleBlob(tab, tabId, cleanupConfig, preserveSelectedElement, i18n) {
  await prepareVisibleCapture(tabId, cleanupConfig, preserveSelectedElement, i18n);

  try {
    return imageDataUrlToBlob(await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }));
  } finally {
    await finishCapture(tabId);
  }
}

async function captureElement(tab, cleanupConfig, i18n) {
  const selection = await selectElement(tab.id, i18n);

  if (selection.fullyVisible) {
    const visibleBlob = await captureVisibleBlob(tab, tab.id, cleanupConfig, true, i18n);
    return cropBlobToRect(
      visibleBlob,
      selection.viewportRect,
      {
        width: selection.viewportWidth,
        height: selection.viewportHeight
      },
      i18n
    );
  }

  const stitchedPayload = await captureSlices(tab, i18n, cleanupConfig, true);
  const stitched = await stitchCaptures(stitchedPayload, i18n);
  return cropBlobToRect(
    stitched.blob,
    selection.pageRect,
    {
      width: stitched.pageWidth,
      height: stitched.pageHeight
    },
    i18n
  );
}

async function runCaptureForMode(tab, request, cleanupConfig, i18n) {
  if (request.captureMode === "visibleArea") {
    return captureVisibleBlob(tab, tab.id, cleanupConfig, false, i18n);
  }

  if (request.captureMode === "element") {
    return captureElement(tab, cleanupConfig, i18n);
  }

  const stitchedPayload = await captureSlices(tab, i18n, cleanupConfig, false);
  const stitched = await stitchCaptures(stitchedPayload, i18n);
  return stitched.blob;
}

async function runTallsnap(request = null) {
  const i18n = await getI18n();
  const settings = await getSettings();
  const tab = await getActiveTab(i18n);
  const effectiveRequest = {
    captureMode: request?.captureMode || settings.defaultCaptureMode,
    outputTarget: request?.outputTarget || settings.defaultOutputTarget,
    outputFormat: request?.outputFormat || settings.defaultOutputFormat,
    filenamePreset: request?.filenamePreset || settings.defaultFilenamePreset,
    cleanupEnabled: request?.cleanupEnabled ?? settings.defaultCleanupEnabled
  };
  const cleanupConfig = buildCleanupConfig(settings, effectiveRequest);

  await ensureCaptureScript(tab.id);
  await setBadge("...");

  try {
    const pngBlob = await runCaptureForMode(tab, effectiveRequest, cleanupConfig, i18n);

    if (effectiveRequest.outputTarget === "download") {
      const prepared = await convertForDownload(pngBlob, effectiveRequest.outputFormat, i18n);
      const filename = buildDownloadFilename(tab, effectiveRequest.filenamePreset, prepared.extension);
      await downloadBlob(prepared.blob, filename, i18n);
    } else {
      await copyImageToClipboard(tab.id, pngBlob, i18n);
      effectiveRequest.outputFormat = "png";
    }

    await setBadge("OK");
    await showPostCaptureToasts(tab.id, effectiveRequest.outputTarget, effectiveRequest.outputFormat, i18n);
    await wait(900);
  } finally {
    await clearBadge();
  }
}

function triggerCapture(request = null) {
  return runTallsnap(request).catch(async (error) => {
    await clearBadge();

    if (isCancellationError(error)) {
      return;
    }

    const i18n = await getI18n();
    notify(
      i18n.t("notification_error_title"),
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  });
}

function buildRequestFromMessage(message) {
  return {
    captureMode: message.captureMode,
    outputTarget: message.outputTarget,
    outputFormat: message.outputFormat,
    filenamePreset: message.filenamePreset,
    cleanupEnabled: message.cleanupEnabled
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "tallsnap-run") {
    const request = buildRequestFromMessage(message);

    if (request.captureMode === "element") {
      void triggerCapture(request).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }

    void triggerCapture(request)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "tallsnap-open-support") {
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
  if (command === "tallsnap-shot") {
    void triggerCapture();
  }
});
