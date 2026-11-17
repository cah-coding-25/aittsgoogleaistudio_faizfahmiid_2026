/**
 * Main World Interceptor for Google AI Studio
 * Runs in the webpage context (world: "MAIN") to intercept genuine Audio Blobs and Download clicks
 * directly in the current generation epoch, preventing stale audio reuse and preventing Chrome's Save As popup.
 * Author: Faiz_Fahmi_ID
 */

(() => {
  if (window.__AI_TTS_MAIN_WORLD_INTERCEPTOR_ACTIVE__) return;
  window.__AI_TTS_MAIN_WORLD_INTERCEPTOR_ACTIVE__ = true;

  console.log('[AI TTS Main World Interceptor] Hooked into Google AI Studio context.');

  let currentEpoch = 0;
  let suppressNativeDownloadClick = false;
  let suppressTimer = null;
  const blobUrlCache = new Map();
  const MAX_BLOB_CACHE = 24;

  function cacheBlobUrl(url, blob) {
    if (!url || !(blob instanceof Blob)) return;
    blobUrlCache.set(url, blob);
    if (blobUrlCache.size > MAX_BLOB_CACHE) {
      const oldestKey = blobUrlCache.keys().next().value;
      if (oldestKey) blobUrlCache.delete(oldestKey);
    }
  }

  function applySuppressState(active) {
    suppressNativeDownloadClick = !!active;
    if (suppressTimer) {
      clearTimeout(suppressTimer);
      suppressTimer = null;
    }
    if (suppressNativeDownloadClick) {
      suppressTimer = setTimeout(() => {
        suppressNativeDownloadClick = false;
      }, 15000);
    }
  }

  // Synchronous CustomEvent bridge from isolated content script (zero postMessage latency)
  window.addEventListener('__AI_TTS_SYNC_CONTROL__', (ev) => {
    const detail = ev?.detail;
    if (!detail) return;
    if (detail.type === 'NEW_EPOCH') {
      currentEpoch = detail.epoch || Date.now();
      applySuppressState(false);
    } else if (detail.type === 'SUPPRESS') {
      if (detail.epoch) currentEpoch = detail.epoch;
      applySuppressState(detail.active);
    }
  });

  // Async postMessage listener (backward compatible)
  window.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === '__AI_TTS_NEW_RUN_EPOCH__') {
      currentEpoch = ev.data.epoch || Date.now();
      applySuppressState(false);
      console.log('[AI TTS Interceptor] New Run Epoch started:', currentEpoch);
    }
    if (ev.data.type === '__AI_TTS_SET_SUPPRESS_DOWNLOAD__') {
      if (ev.data.epoch) currentEpoch = ev.data.epoch;
      applySuppressState(ev.data.active);
    }
  });

  function sendAudioBuffer(arrayBuffer, source) {
    if (!arrayBuffer || arrayBuffer.byteLength < 3000) return;
    try {
      const bytes = new Uint8Array(arrayBuffer.slice(0, 12));
      const riffHeader = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      const waveHeader = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (riffHeader !== 'RIFF' || waveHeader !== 'WAVE') {
        return;
      }

      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          window.postMessage(
            {
              type: '__AI_TTS_BLOB_DATA_CAPTURED__',
              dataUrl: reader.result,
              size: arrayBuffer.byteLength,
              mime: 'audio/wav',
              source,
              epoch: currentEpoch,
            },
            '*'
          );
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.log('[AI TTS Interceptor] Audio buffer note:', e?.message || e);
    }
  }

  function postInterceptedDataUrl(dataUrl, size, mime) {
    window.postMessage(
      {
        type: '__AI_TTS_INTERCEPTED_DOWNLOAD_DATAURL__',
        dataUrl,
        size: size || dataUrl.length,
        mime: mime || 'audio/wav',
        epoch: currentEpoch,
      },
      '*'
    );
  }

  function emitBlobAsIntercepted(blob) {
    if (!blob || blob.size < 1000) return false;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl) {
        postInterceptedDataUrl(dataUrl, blob.size, blob.type || 'audio/wav');
      }
    };
    reader.readAsDataURL(blob);
    return true;
  }

  function interceptAnchorDownload(href, fallbackFn) {
    if (!href || href.startsWith('blob:null')) {
      if (fallbackFn && !suppressNativeDownloadClick) fallbackFn();
      return;
    }

    // Fast path 1: Inline data: URL (synchronous, zero delay)
    if (href.startsWith('data:')) {
      postInterceptedDataUrl(href, href.length, 'audio/wav');
      return;
    }

    // Fast path 2: Cached Blob from URL.createObjectURL (immune to immediate revokeObjectURL!)
    const cachedBlob = blobUrlCache.get(href);
    if (cachedBlob && cachedBlob.size >= 1000) {
      emitBlobAsIntercepted(cachedBlob);
      return;
    }

    // Path 3: Fetch blob URL/HTTP URL
    fetch(href)
      .then((r) => r.blob())
      .then((blob) => {
        if (!blob || blob.size < 1000) {
          if (fallbackFn && !suppressNativeDownloadClick) fallbackFn();
          return;
        }
        emitBlobAsIntercepted(blob);
      })
      .catch(() => {
        if (fallbackFn && !suppressNativeDownloadClick) fallbackFn();
      });
  }

  // Hook WebAudio AudioContext.decodeAudioData (captures audio decoded after Run)
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass && AudioContextClass.prototype) {
    const origDecodeAudioData = AudioContextClass.prototype.decodeAudioData;
    AudioContextClass.prototype.decodeAudioData = function (audioData) {
      if (currentEpoch > 0 && audioData instanceof ArrayBuffer) {
        sendAudioBuffer(audioData.slice(0), 'AudioContext.decodeAudioData');
      }
      return origDecodeAudioData.apply(this, arguments);
    };
  }

  // Hook URL.createObjectURL & URL.revokeObjectURL
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.apply(this, arguments);
    try {
      if (
        obj instanceof Blob &&
        (obj.type.includes('audio') || obj.type.includes('wav') || obj.size >= 3000)
      ) {
        cacheBlobUrl(url, obj);
        if (currentEpoch > 0) {
          const reader = new FileReader();
          reader.onload = function () {
            if (reader.result instanceof ArrayBuffer) {
              sendAudioBuffer(reader.result, 'URL.createObjectURL');
            }
          };
          reader.readAsArrayBuffer(obj);
        }
      }
    } catch (e) {}
    return url;
  };

  // Hook HTMLAnchorElement.prototype.click to intercept programmatic <a download> clicks cleanly
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const anchor = this;
    const href = anchor.href || '';
    const isAudioDownload =
      anchor.hasAttribute('download') ||
      href.startsWith('blob:') ||
      href.startsWith('data:audio') ||
      href.toLowerCase().includes('.wav');

    if (suppressNativeDownloadClick && isAudioDownload && href) {
      console.log('[AI TTS Interceptor] Intercepted programmatic <a download>.click() cleanly:', href);
      if (!href.startsWith('blob:null')) {
        interceptAnchorDownload(href, null);
      }
      return;
    }

    // Normal manual click when not suppressing: still capture buffer if valid, allow native download
    try {
      if (isAudioDownload && href && !href.startsWith('blob:null')) {
        const cached = blobUrlCache.get(href);
        if (cached) {
          cached.arrayBuffer().then((buf) => sendAudioBuffer(buf, 'HTMLAnchorElement.click')).catch(() => {});
        } else {
          fetch(href)
            .then((r) => r.arrayBuffer())
            .then((buf) => sendAudioBuffer(buf, 'HTMLAnchorElement.click'))
            .catch(() => {});
        }
      }
    } catch (e) {}
    return origAnchorClick.apply(this, arguments);
  };

  // Capture-phase click listener (including Shadow DOM via composedPath)
  document.addEventListener(
    'click',
    (e) => {
      if (!suppressNativeDownloadClick) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      const anchor = path.find(
        (node) =>
          node instanceof HTMLAnchorElement &&
          (node.hasAttribute('download') || (node.href || '').startsWith('blob:') || (node.href || '').startsWith('data:audio'))
      );
      if (!anchor) return;
      const href = anchor.href || '';
      if (!href) return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      console.log('[AI TTS Interceptor] Intercepted DOM <a download> click cleanly:', href);
      if (!href.startsWith('blob:null')) {
        interceptAnchorDownload(href, null);
      }
    },
    true
  );

  // Also catch synthetic dispatchEvent(new MouseEvent('click')) on detached <a download> anchors
  const origDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (
      suppressNativeDownloadClick &&
      event &&
      event.type === 'click' &&
      this instanceof HTMLAnchorElement
    ) {
      const href = this.href || '';
      const isAudioDownload =
        this.hasAttribute('download') ||
        href.startsWith('blob:') ||
        href.startsWith('data:audio') ||
        href.toLowerCase().includes('.wav');
      if (isAudioDownload && href) {
        console.log('[AI TTS Interceptor] Intercepted dispatchEvent <a download> cleanly:', href);
        if (!href.startsWith('blob:null')) {
          interceptAnchorDownload(href, null);
        }
        return false;
      }
    }
    return origDispatchEvent.apply(this, arguments);
  };

  // Guard window.open for blob/audio URLs during active automation download click
  const origWindowOpen = window.open;
  if (typeof origWindowOpen === 'function') {
    window.open = function (url) {
      if (
        suppressNativeDownloadClick &&
        typeof url === 'string' &&
        (url.startsWith('blob:') || url.startsWith('data:audio') || url.toLowerCase().includes('.wav'))
      ) {
        interceptAnchorDownload(url, null);
        return null;
      }
      return origWindowOpen.apply(this, arguments);
    };
  }
})();
