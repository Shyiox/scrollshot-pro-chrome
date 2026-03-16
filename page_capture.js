(function installTallsnapCapture() {
  if (window.__tallsnapCaptureInstalled) {
    return;
  }

  window.__tallsnapCaptureInstalled = true;

  const state = {
    hiddenElements: [],
    originalScrollX: 0,
    originalScrollY: 0,
    activeToast: null,
    toastTimeoutId: null,
    toastQueue: Promise.resolve(),
    selectedElement: null,
    pickerCleanup: null,
    pickerOverlay: null,
    pickerFrame: null,
    pickerHint: null,
    pickerCurrentElement: null
  };

  const TOAST_ID = "tallsnap-toast";
  const PICKER_ROOT_ID = "tallsnap-picker-root";
  const PICKER_MIN_SIZE = 18;

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

  function isVisibleElement(style) {
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getElementTextTokens(element) {
    const parts = [
      element.id,
      element.className,
      element.getAttribute("aria-label"),
      element.getAttribute("role"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("title"),
      element.getAttribute("name")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return parts;
  }

  function isCleanupSkipped(element, preserveSelectedElement) {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    if (element === document.body || element === document.documentElement) {
      return true;
    }

    if (element.closest(`[data-tallsnap-ui="${PICKER_ROOT_ID}"]`)) {
      return true;
    }

    if (!preserveSelectedElement || !state.selectedElement) {
      return false;
    }

    return (
      element === state.selectedElement ||
      element.contains(state.selectedElement) ||
      state.selectedElement.contains(element)
    );
  }

  function rememberAndHideElement(element) {
    state.hiddenElements.push({
      element,
      style: element.getAttribute("style")
    });

    element.style.setProperty("visibility", "hidden", "important");
    element.style.setProperty("opacity", "0", "important");
    element.style.setProperty("pointer-events", "none", "important");
    element.style.setProperty("transition", "none", "important");
  }

  function shouldHideSticky(style, rect) {
    const isFloating = style.position === "fixed" || style.position === "sticky";
    return isFloating && rect.width >= 140 && rect.height >= 28;
  }

  function shouldHideCookieBanner(element, style, rect, tokens) {
    if (!/cookie|consent|gdpr|privacy|onetrust|usercentrics|iubenda|cybot|trustarc|cmp/.test(tokens)) {
      return false;
    }

    return shouldHideSticky(style, rect) || rect.height >= 48 || rect.width >= window.innerWidth * 0.6;
  }

  function shouldHideChatWidget(element, style, rect, tokens) {
    if (!/chat|intercom|crisp|drift|zendesk|messenger|tawk|livechat|chatwoot|launcher|support/.test(tokens)) {
      return false;
    }

    return style.position === "fixed" || (rect.width <= 420 && rect.height <= 420);
  }

  function shouldHideOverlay(element, style, rect, tokens) {
    const isDialog =
      element.getAttribute("aria-modal") === "true" ||
      element.getAttribute("role") === "dialog" ||
      element.getAttribute("role") === "alertdialog";
    const hasOverlayWords = /overlay|modal|popup|lightbox|backdrop|drawer/.test(tokens);
    const coversLargeArea =
      style.position === "fixed" &&
      rect.width >= window.innerWidth * 0.55 &&
      rect.height >= window.innerHeight * 0.3;

    return isDialog || hasOverlayWords || coversLargeArea;
  }

  function applyCleanup(cleanupConfig = {}, preserveSelectedElement = false) {
    state.hiddenElements = [];

    if (!cleanupConfig.enabled || !document.body) {
      return;
    }

    const seen = new Set();
    const elements = document.body.querySelectorAll("*");

    for (const element of elements) {
      if (!(element instanceof HTMLElement) || seen.has(element) || isCleanupSkipped(element, preserveSelectedElement)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      if (!isVisibleElement(style)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        continue;
      }

      const tokens = getElementTextTokens(element);
      let shouldHide = false;

      if (cleanupConfig.sticky && shouldHideSticky(style, rect)) {
        shouldHide = true;
      } else if (cleanupConfig.cookies && shouldHideCookieBanner(element, style, rect, tokens)) {
        shouldHide = true;
      } else if (cleanupConfig.chat && shouldHideChatWidget(element, style, rect, tokens)) {
        shouldHide = true;
      } else if (cleanupConfig.overlays && shouldHideOverlay(element, style, rect, tokens)) {
        shouldHide = true;
      }

      if (!shouldHide) {
        continue;
      }

      seen.add(element);
      rememberAndHideElement(element);
    }
  }

  function restoreCleanup() {
    for (const entry of state.hiddenElements) {
      if (!(entry.element instanceof HTMLElement)) {
        continue;
      }

      if (entry.style === null) {
        entry.element.removeAttribute("style");
      } else {
        entry.element.setAttribute("style", entry.style);
      }
    }

    state.hiddenElements = [];
  }

  function getToastStyles(variant) {
    if (variant === "support") {
      return {
        iconKind: "coffee",
        iconBackground: "linear-gradient(180deg, #D48846 0%, #B56C31 100%)",
        iconColor: "#FFFDF9",
        background: "rgba(255, 252, 247, 0.98)",
        border: "1px solid #D9CCBB",
        textColor: "#1F2328",
        messageColor: "#5F6771"
      };
    }

    return {
      iconKind: "brand",
      iconBackground: "#F4E3CD",
      iconColor: "#94571F",
      background: "rgba(255, 252, 247, 0.98)",
      border: "1px solid #D9CCBB",
      textColor: "#1F2328",
      messageColor: "#5F6771"
    };
  }

  function getToastIconMarkup(kind, color) {
    if (kind === "coffee") {
      return `
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M7 10h8.5a1 1 0 0 1 1 1v3.5A4.5 4.5 0 0 1 12 19H10.5A3.5 3.5 0 0 1 7 15.5V11a1 1 0 0 1 1-1Z" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M16.5 11h1a2.25 2.25 0 1 1 0 4.5h-1" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M9 21h7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M10 6c0-1.1.8-1.7.8-2.8" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
          <path d="M13.5 6c0-1 .8-1.6.8-2.7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="6" y="5.5" width="12" height="14" rx="3" fill="none" stroke="${color}" stroke-width="1.8"></rect>
        <rect x="9" y="3" width="6" height="4" rx="1.5" fill="none" stroke="${color}" stroke-width="1.8"></rect>
        <path d="M9.5 10h5" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M9.5 13.5h5" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M9.5 17h3.2" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function removeActiveToast() {
    if (state.toastTimeoutId) {
      window.clearTimeout(state.toastTimeoutId);
      state.toastTimeoutId = null;
    }

    if (state.activeToast) {
      state.activeToast.remove();
      state.activeToast = null;
    }
  }

  function showToastNow(payload) {
    const {
      title,
      message,
      variant = "success",
      durationMs = variant === "support" ? 2600 : 2100
    } = payload;

    if (!document.body) {
      return Promise.resolve();
    }

    removeActiveToast();

    const styles = getToastStyles(variant);
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.setAttribute("role", "status");
    toast.style.position = "fixed";
    toast.style.right = "18px";
    toast.style.bottom = "18px";
    toast.style.zIndex = "2147483647";
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.gap = "10px";
    toast.style.maxWidth = "min(320px, calc(100vw - 32px))";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "16px";
    toast.style.background = styles.background;
    toast.style.color = styles.textColor;
    toast.style.border = styles.border;
    toast.style.font = '13px/1.35 "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif';
    toast.style.boxShadow = "0 16px 32px rgba(44, 32, 20, 0.16)";
    toast.style.backdropFilter = "blur(12px)";
    toast.style.webkitBackdropFilter = "blur(12px)";
    toast.style.pointerEvents = "none";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "opacity 160ms ease, transform 160ms ease";

    const iconWrap = document.createElement("div");
    iconWrap.style.display = "grid";
    iconWrap.style.placeItems = "center";
    iconWrap.style.minWidth = "32px";
    iconWrap.style.height = "32px";
    iconWrap.style.borderRadius = "10px";
    iconWrap.style.background = styles.iconBackground;
    iconWrap.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.28)";
    iconWrap.innerHTML = getToastIconMarkup(styles.iconKind, styles.iconColor);

    const textWrap = document.createElement("div");
    textWrap.style.display = "flex";
    textWrap.style.flexDirection = "column";
    textWrap.style.gap = "2px";

    const titleElement = document.createElement("div");
    titleElement.textContent = title;
    titleElement.style.fontWeight = "800";
    titleElement.style.fontSize = "13px";

    const messageElement = document.createElement("div");
    messageElement.textContent = message;
    messageElement.style.fontWeight = "500";
    messageElement.style.fontSize = "12px";
    messageElement.style.color = styles.messageColor;

    textWrap.appendChild(titleElement);
    textWrap.appendChild(messageElement);
    toast.appendChild(iconWrap);
    toast.appendChild(textWrap);

    document.body.appendChild(toast);
    state.activeToast = toast;

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    return new Promise((resolve) => {
      state.toastTimeoutId = window.setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";

        window.setTimeout(() => {
          if (state.activeToast === toast) {
            toast.remove();
            state.activeToast = null;
          }

          state.toastTimeoutId = null;
          resolve();
        }, 180);
      }, durationMs);
    });
  }

  function enqueueToast(payload) {
    state.toastQueue = state.toastQueue
      .catch(() => {})
      .then(() => showToastNow(payload));

    return state.toastQueue;
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

  function resetPickerUi() {
    if (state.pickerOverlay) {
      state.pickerOverlay.remove();
      state.pickerOverlay = null;
      state.pickerFrame = null;
      state.pickerHint = null;
      state.pickerCurrentElement = null;
    }
  }

  function placePickerHint() {
    if (!state.pickerHint) {
      return;
    }

    state.pickerHint.style.left = "50%";
    state.pickerHint.style.top = "16px";
  }

  function updatePickerFrame(element) {
    if (!state.pickerFrame || !state.pickerHint) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < PICKER_MIN_SIZE || rect.height < PICKER_MIN_SIZE) {
      return;
    }

    state.pickerCurrentElement = element;
    state.pickerFrame.style.display = "block";
    state.pickerFrame.style.left = `${rect.left - 4}px`;
    state.pickerFrame.style.top = `${rect.top - 4}px`;
    state.pickerFrame.style.width = `${rect.width + 8}px`;
    state.pickerFrame.style.height = `${rect.height + 8}px`;

    placePickerHint();
  }

  function findReasonableTarget(startElement) {
    let current = startElement instanceof Element ? startElement : null;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current.closest(`[data-tallsnap-ui="${PICKER_ROOT_ID}"]`)) {
        return null;
      }

      const rect = current.getBoundingClientRect();
      if (rect.width >= PICKER_MIN_SIZE && rect.height >= PICKER_MIN_SIZE) {
        return current;
      }

      current = current.parentElement;
    }

    return startElement instanceof Element ? startElement : null;
  }

  function cleanupPicker() {
    if (state.pickerCleanup) {
      state.pickerCleanup();
      state.pickerCleanup = null;
    }
  }

  function buildSelectionPayload(element) {
    const rect = element.getBoundingClientRect();

    return {
      pageRect: {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      },
      viewportRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      fullyVisible:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight
    };
  }

  function pickElement({ title, message, cancelLabel }) {
    cleanupPicker();
    resetPickerUi();

    if (!document.body) {
      return Promise.resolve({ cancelled: true });
    }

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.dataset.tallsnapUi = PICKER_ROOT_ID;
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2147483646";
      overlay.style.pointerEvents = "none";

      const frame = document.createElement("div");
      frame.style.position = "fixed";
      frame.style.display = "none";
      frame.style.border = "2px solid #B87434";
      frame.style.borderRadius = "14px";
      frame.style.boxShadow = "0 0 0 9999px rgba(19, 24, 32, 0.18)";
      frame.style.background = "rgba(184, 116, 52, 0.08)";
      frame.style.transition = "left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease";

      const hint = document.createElement("div");
      hint.style.position = "fixed";
      hint.style.left = "50%";
      hint.style.top = "16px";
      hint.style.transform = "translateX(-50%)";
      hint.style.maxWidth = "min(520px, calc(100vw - 24px))";
      hint.style.padding = "12px 14px";
      hint.style.borderRadius = "16px";
      hint.style.background = "rgba(255, 252, 247, 0.97)";
      hint.style.border = "1px solid #D9CCBB";
      hint.style.color = "#1F2328";
      hint.style.boxShadow = "0 18px 34px rgba(44, 32, 20, 0.16)";
      hint.style.font = '12px/1.35 "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif';
      hint.style.backdropFilter = "blur(12px)";
      hint.style.webkitBackdropFilter = "blur(12px)";

      const hintTitle = document.createElement("div");
      hintTitle.textContent = title;
      hintTitle.style.fontWeight = "800";
      hintTitle.style.fontSize = "13px";

      const hintBody = document.createElement("div");
      hintBody.textContent = message;
      hintBody.style.marginTop = "4px";
      hintBody.style.color = "#5F6771";

      const hintMeta = document.createElement("div");
      hintMeta.textContent = cancelLabel;
      hintMeta.style.display = "inline-flex";
      hintMeta.style.alignItems = "center";
      hintMeta.style.marginTop = "8px";
      hintMeta.style.padding = "4px 8px";
      hintMeta.style.borderRadius = "999px";
      hintMeta.style.background = "#F4E3CD";
      hintMeta.style.color = "#94571F";
      hintMeta.style.fontWeight = "700";

      hint.appendChild(hintTitle);
      hint.appendChild(hintBody);
      hint.appendChild(hintMeta);
      overlay.appendChild(frame);
      overlay.appendChild(hint);
      document.documentElement.appendChild(overlay);

      state.pickerOverlay = overlay;
      state.pickerFrame = frame;
      state.pickerHint = hint;
      placePickerHint();

      const onMouseMove = (event) => {
        const target = findReasonableTarget(event.target);
        if (target) {
          updatePickerFrame(target);
        }
      };

      const onScroll = () => {
        if (state.pickerCurrentElement) {
          updatePickerFrame(state.pickerCurrentElement);
        }
      };

      const onClick = (event) => {
        const target = findReasonableTarget(event.target);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (!target) {
          return;
        }

        state.selectedElement = target;
        const selection = buildSelectionPayload(target);
        cleanupPicker();
        resolve({ cancelled: false, selection });
      };

      const onKeyDown = (event) => {
        if (event.key !== "Escape") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cleanupPicker();
        resolve({ cancelled: true });
      };

      state.pickerCleanup = () => {
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScroll, true);
        resetPickerUi();
      };

      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onScroll, true);
    });
  }

  function beginCapture(cleanupConfig, preserveSelectedElement) {
    state.originalScrollX = window.scrollX;
    state.originalScrollY = window.scrollY;
    applyCleanup(cleanupConfig, preserveSelectedElement);
  }

  function finishCapture() {
    restoreCleanup();
    cleanupPicker();
    window.scrollTo(state.originalScrollX, state.originalScrollY);
    state.selectedElement = null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "tallsnap-pick-element") {
      void (async () => {
        try {
          const result = await pickElement(message);
          sendResponse({
            ok: true,
            cancelled: result.cancelled,
            selection: result.selection
          });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();

      return true;
    }

    if (message?.type === "tallsnap-start-capture") {
      try {
        beginCapture(message.cleanupConfig, message.preserveSelectedElement);
        const metrics = getPageMetrics();

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

    if (message?.type === "tallsnap-prepare-visible") {
      try {
        beginCapture(message.cleanupConfig, message.preserveSelectedElement);
        sendResponse({
          ok: true,
          metrics: getPageMetrics()
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return true;
    }

    if (message?.type === "tallsnap-scroll") {
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

    if (message?.type === "tallsnap-finish") {
      try {
        finishCapture();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return true;
    }

    if (message?.type === "tallsnap-copy-image") {
      void (async () => {
        try {
          await copyImageDataUrl(message.dataUrl);
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

    if (message?.type === "tallsnap-show-toast") {
      void enqueueToast({
        title: message.title,
        message: message.message,
        variant: message.variant
      });
      sendResponse({ ok: true });

      return true;
    }

    return undefined;
  });
})();
