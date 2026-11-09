/**
 * Bridge Script injected into the local website dashboard.
 * Provides two-way communication between the React app and Chrome Extension.
 */

(() => {
  console.log('[AI TTS Bridge] Initialized on dashboard page.');

  // Announce presence to page window
  function announceReady() {
    window.postMessage(
      {
        source: 'AI_TTS_EXTENSION',
        type: 'EXTENSION_READY',
        version: '1.0.0',
      },
      '*'
    );
  }

  announceReady();
  setTimeout(announceReady, 400);
  setTimeout(announceReady, 1000);
  setTimeout(announceReady, 2000);
  setTimeout(announceReady, 4000);

  // Listen to messages from Website
  window.addEventListener('message', async (event) => {
    // Only process messages destined for the extension
    if (event.data?.target !== 'AI_TTS_EXTENSION') return;

    const { type, messageId, payload } = event.data;

    if (type === 'PING_BRIDGE') {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: 'PING_BRIDGE_RESPONSE',
          messageId,
          payload: { ready: true, version: '1.0.0' },
        },
        '*'
      );
      return;
    }

    try {
      // Forward request to background service worker
      const response = await chrome.runtime.sendMessage({
        type,
        messageId,
        payload,
      });

      // Send response back to webpage
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: `${type}_RESPONSE`,
          messageId,
          payload: response,
        },
        '*'
      );
    } catch (err) {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: 'ERROR_REPORT',
          messageId,
          payload: { error: err.message },
        },
        '*'
      );
    }
  });

  // Listen to messages from background service worker to forward to webpage
  chrome.runtime.onMessage.addListener((message) => {
    if (message.source === 'AI_TTS_BACKGROUND') {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: message.type,
          payload: message.payload,
        },
        '*'
      );
    }
  });
})();
