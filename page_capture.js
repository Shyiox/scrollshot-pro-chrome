(function installScrollshotCapture() {
  if (window.__scrollshotCaptureInstalled) {
    return;
  }

  window.__scrollshotCaptureInstalled = true;

  const state = {
    hiddenElements: [],
    originalScrollX: 0,
    originalScrollY: 0,
    toastElement: null,
    toastTimeoutId: null
  };

  const TOAST_ID = "scrollshot-toast";
  const TOAST_DURATION_MS = 2600;

  function getPageMetrics() {
    const doc = document.documentElement;
    const body = document.body;

    const pageWidth = Math.max(
      doc.scrollWidth,
      doc.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.clientWidth : 0
    );

    const pageHeight = Math.max(
      doc.scrollHeight,
      doc.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.clientHeight : 0
    );

    return {
      pageWidth,
      pageHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  function hideFloatingElements() {
    state.hiddenElements = [];

    const elements = document.body ? document.body.querySelectorAll("*") : [];
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const isFloating = style.position === "fixed" || style.position === "sticky";

      if (!isFloating || style.display === "none" || style.visibility === "hidden") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        continue;
      }

      state.hiddenElements.push({
        element,
        visibility: element.style.visibility
      });
      element.style.visibility = "hidden";
    }
  }

  function restoreFloatingElements() {
    for (const entry of state.hiddenElements) {
      entry.element.style.visibility = entry.visibility;
    }

    state.hiddenElements = [];
  }

  function showCompletionToast(title, message) {
    if (!document.body) {
      return;
    }

    if (state.toastTimeoutId) {
      window.clearTimeout(state.toastTimeoutId);
      state.toastTimeoutId = null;
    }

    if (state.toastElement) {
      state.toastElement.remove();
      state.toastElement = null;
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.setAttribute("role", "status");
    toast.style.position = "fixed";
    toast.style.left = "50%";
    toast.style.top = "26px";
    toast.style.zIndex = "2147483647";
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.gap = "12px";
    toast.style.maxWidth = "min(320px, calc(100vw - 32px))";
    toast.style.padding = "10px 14px";
    toast.style.borderRadius = "12px";
    toast.style.background = "rgba(245, 247, 250, 0.98)";
    toast.style.color = "#0f172a";
    toast.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    toast.style.font = '14px/1.2 "Segoe UI", Arial, sans-serif';
    toast.style.boxShadow = "0 14px 30px rgba(15, 23, 42, 0.16)";
    toast.style.backdropFilter = "blur(8px)";
    toast.style.webkitBackdropFilter = "blur(8px)";
    toast.style.pointerEvents = "none";
    toast.style.opacity = "0";
    toast.style.transform = "translate(-50%, -10px)";
    toast.style.transition = "opacity 160ms ease, transform 160ms ease";

    const iconWrap = document.createElement("div");
    iconWrap.style.display = "grid";
    iconWrap.style.placeItems = "center";
    iconWrap.style.width = "24px";
    iconWrap.style.height = "24px";
    iconWrap.style.borderRadius = "999px";
    iconWrap.style.background = "#0f172a";
    iconWrap.style.color = "#ffffff";
    iconWrap.style.font = '700 14px/1 "Segoe UI", Arial, sans-serif';
    iconWrap.textContent = "i";

    const textWrap = document.createElement("div");
    textWrap.style.display = "flex";
    textWrap.style.flexDirection = "column";
    textWrap.style.gap = "1px";

    const titleElement = document.createElement("div");
    titleElement.textContent = title;
    titleElement.style.fontWeight = "700";
    titleElement.style.fontSize = "13px";

    const messageElement = document.createElement("div");
    messageElement.textContent = message;
    messageElement.style.fontWeight = "500";
    messageElement.style.fontSize = "12px";
    messageElement.style.color = "#334155";

    textWrap.appendChild(titleElement);
    textWrap.appendChild(messageElement);
    toast.appendChild(iconWrap);
    toast.appendChild(textWrap);

    document.body.appendChild(toast);
    state.toastElement = toast;

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translate(-50%, 0)";
    });

    state.toastTimeoutId = window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translate(-50%, -10px)";

      window.setTimeout(() => {
        if (state.toastElement === toast) {
          toast.remove();
          state.toastElement = null;
        }
      }, 180);

      state.toastTimeoutId = null;
    }, TOAST_DURATION_MS);
  }

  function buildSegments(metrics) {
    const maxScrollY = Math.max(0, metrics.pageHeight - metrics.viewportHeight);
    const segments = [];
    let covered = 0;

    while (covered < metrics.pageHeight) {
      const scrollY = Math.min(covered, maxScrollY);
      const sourceY = covered - scrollY;
      const height = Math.min(metrics.viewportHeight - sourceY, metrics.pageHeight - covered);

      segments.push({
        scrollY,
        sourceY,
        destY: covered,
        height
      });

      covered += height;
    }

    return segments;
  }

  async function settleAfterScroll() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 90));
  }

  async function copyImageDataUrl(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blob
      })
    ]);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "scrollshot-start") {
      try {
        state.originalScrollX = window.scrollX;
        state.originalScrollY = window.scrollY;

        const metrics = getPageMetrics();
        hideFloatingElements();

        sendResponse({
          ok: true,
          plan: {
            ...metrics,
            segments: buildSegments(metrics)
          }
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return true;
    }

    if (message?.type === "scrollshot-scroll") {
      void (async () => {
        try {
          window.scrollTo(0, message.scrollY);
          await settleAfterScroll();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();

      return true;
    }

    if (message?.type === "scrollshot-finish") {
      try {
        restoreFloatingElements();
        window.scrollTo(state.originalScrollX, state.originalScrollY);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return true;
    }

    if (message?.type === "scrollshot-copy-image") {
      void (async () => {
        try {
          await copyImageDataUrl(message.dataUrl);
          showCompletionToast("Screenshot Pro", "Successfully copied");
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();

      return true;
    }

    return undefined;
  });
})();
