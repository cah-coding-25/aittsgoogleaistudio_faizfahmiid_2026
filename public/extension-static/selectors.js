/**
 * Modular selector engine for Google AI Studio
 * Optimized specifically for https://aistudio.google.com/generate-speech
 * Uses accessible labels, ARIA attributes, semantic hierarchy, and resilient fallback candidates.
 */

window.AI_STUDIO_SELECTORS = {
  version: '1.1.0',

  // Selectors to find prompt / text input for TTS - MUST target the Speaker dialogue block, NOT Scene or Sample Context!
  textInput: {
    strategies: [
      // Strategy 1: Find speech turn/chunk container associated with "Speaker 1" or speaker header
      () => {
        const allElements = Array.from(document.querySelectorAll('*'));
        // Find element that has text like "Speaker 1", "Speaker 1 - Aoede", etc.
        const speakerLabel = allElements.find((el) => {
          if (el.closest('#ai-tts-automation-dock')) return false;
          const txt = (el.innerText || el.textContent || '').trim();
          return (
            (txt.startsWith('Speaker 1') || txt.includes('Speaker 1 -') || txt === 'Speaker 1') &&
            el.children.length <= 4 &&
            !el.closest('textarea')
          );
        });

        if (speakerLabel) {
          // Look inside the closest speech block or parent card
          const turnContainer = speakerLabel.closest(
            'ms-speech-chunk, ms-speech-turn, ms-speech-block, ms-turn, .speech-block, [class*="speech-turn"], [class*="speaker-chunk"], [class*="speech-chunk"], [data-testid*="turn"], [data-testid*="speech"]'
          ) || speakerLabel.parentElement?.parentElement;

          if (turnContainer) {
            const input = turnContainer.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
            if (input && !input.closest('#ai-tts-automation-dock')) return input;
          }

          // Alternatively, look for following sibling editable element
          let sibling = speakerLabel.nextElementSibling;
          while (sibling) {
            const editable = sibling.matches?.('[contenteditable="true"], textarea, [role="textbox"]')
              ? sibling
              : sibling.querySelector?.('[contenteditable="true"], textarea, [role="textbox"]');
            if (editable && !editable.closest('#ai-tts-automation-dock')) return editable;
            sibling = sibling.nextElementSibling;
          }
        }
        return null;
      },

      // Strategy 2: Look for editable element containing template text or placeholder matching speech dialogue (e.g. "Type '[' for tags", "[amused]", "Blackwood House")
      () => {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'));
        for (const el of editables) {
          if (el.closest('#ai-tts-automation-dock')) continue;

          // Check if this input is Scene or Sample Context - EXCLUDE THEM!
          const parentText = (el.parentElement?.innerText || '').toLowerCase();
          const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

          if (
            placeholder.includes('scene') ||
            placeholder.includes('sample context') ||
            ariaLabel.includes('scene') ||
            ariaLabel.includes('sample context') ||
            parentText.startsWith('scene') ||
            parentText.startsWith('sample context')
          ) {
            continue; // STRICTLY EXCLUDE SCENE & SAMPLE CONTEXT
          }

          const currentContent = (el.innerText || el.value || el.textContent || '').trim();
          if (
            currentContent.includes("Type '[' for tags") ||
            currentContent.includes('[amused]') ||
            currentContent.includes('Blackwood House') ||
            placeholder.includes("Type '[' for tags") ||
            placeholder.includes('speech') ||
            placeholder.includes('dialogue')
          ) {
            return el;
          }
        }
        return null;
      },

      // Strategy 3: Find editable element that is strictly NOT Scene or Sample Context and has large dimensions
      () => {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'));
        const filtered = editables.filter((el) => {
          if (el.closest('#ai-tts-automation-dock')) return false;

          const prevElText = (el.previousElementSibling?.innerText || '').toLowerCase();
          const parentElText = (el.parentElement?.firstElementChild?.innerText || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

          if (
            aria.includes('scene') ||
            aria.includes('context') ||
            placeholder.includes('scene') ||
            placeholder.includes('context') ||
            prevElText.includes('scene') ||
            prevElText.includes('context') ||
            parentElText.includes('scene') ||
            parentElText.includes('context')
          ) {
            return false;
          }

          const rect = el.getBoundingClientRect();
          return rect.width > 80 && rect.height > 20;
        });

        // If multiple, pick the one that follows a speaker block or is located in the middle/lower part of playground
        if (filtered.length > 0) {
          // Sort by distance from top (Scene and Context are higher up, speaker dialogue is below them)
          filtered.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          return filtered[filtered.length - 1]; // Pick lowest/dialogue one
        }
        return null;
      }
    ]
  },

  // Selectors to find Run / Submit / Generate button (Matches "Run Ctrl ↵" in screenshot)
  runButton: {
    strategies: [
      // Strategy 1: Button with text starting with or containing 'Run' (e.g. "Run Ctrl ↵", "Run", "Generate")
      () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.find((btn) => {
          if (btn.closest('#ai-tts-automation-dock')) return false;
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
          const isRun = (
            text.startsWith('run') ||
            text.includes('run ctrl') ||
            text === 'run' ||
            text === 'generate' ||
            aria.includes('run') ||
            aria.includes('generate')
          );
          return isRun && !btn.disabled;
        }) || null;
      },
      // Strategy 2: Specific AI studio action button test IDs or class
      () => {
        const el = document.querySelector('button[data-test-id="run-button"], button.run-button, button.mat-primary, button[aria-label*="Run" i]');
        if (el && !el.closest('#ai-tts-automation-dock')) return el;
        return null;
      },
      // Strategy 3: Bottom action bar primary run button
      () => {
        const bottomBtns = Array.from(document.querySelectorAll('footer button, .bottom-bar button, .action-bar button, button[type="submit"]'));
        return bottomBtns.find((b) => {
          if (b.closest('#ai-tts-automation-dock')) return false;
          const t = (b.innerText || '').toLowerCase();
          return (t.includes('run') || t.includes('generate')) && !b.disabled;
        }) || null;
      }
    ]
  },

  // Selectors for detecting in-progress generation
  generatingIndicator: {
    strategies: [
      // Strategy 1: 'Stop' button active
      () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.find((btn) => {
          if (btn.closest('#ai-tts-automation-dock')) return false;
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
          return text === 'stop' || aria === 'stop' || aria.includes('stop generation');
        }) || null;
      },
      // Strategy 2: Progress indicators, spinners, progress bars
      () => document.querySelector('mat-progress-spinner, mat-progress-bar, .spinner, [role="progressbar"], .generating-indicator, .loading-dots')
    ]
  },

  // Helper to reliably check element visibility without broken offsetParent checks
  isElementVisible: (el) => {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    } catch (e) {}
    return true;
  },

  // Selectors to find download button and audio output elements
  audioOutput: {
    strategies: [
      // Strategy 1: Real HTML5 <audio> tag with valid src or source child
      () => {
        const audios = Array.from(document.querySelectorAll('audio'));
        return audios.find((a) => {
          if (a.closest('#ai-tts-automation-dock')) return false;
          const src = a.src || a.currentSrc || a.querySelector('source')?.src;
          return src && (src.startsWith('blob:') || src.startsWith('http') || src.startsWith('data:'));
        }) || audios[audios.length - 1] || null;
      },
      // Strategy 2: Download audio button in bottom bar
      () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[download]'));
        return buttons.find((b) => {
          if (b.closest('#ai-tts-automation-dock')) return false;
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          const tooltip = (b.getAttribute('mattooltip') || '').toLowerCase();
          const text = (b.innerText || '').toLowerCase();
          const matIcon = b.querySelector('mat-icon, svg, [class*="icon"]');
          const matText = (matIcon?.textContent || '').toLowerCase();
          const isDownload = (
            aria.includes('download') ||
            aria.includes('unduh') ||
            title.includes('download') ||
            title.includes('unduh') ||
            tooltip.includes('download') ||
            tooltip.includes('unduh') ||
            matText.includes('download') ||
            matText.includes('file_download') ||
            matText.includes('arrow_downward') ||
            matText.includes('save_alt') ||
            matText.includes('get_app') ||
            b.hasAttribute('download')
          );
          return isDownload && window.AI_STUDIO_SELECTORS.isElementVisible(b);
        }) || null;
      },
      // Strategy 3: Media controller container
      () => document.querySelector('.audio-player, [data-test-id*="audio"], media-controller, .tts-player, ms-prompt-run-bar')
    ]
  },

  // Dedicated selector for the explicit Download button in Google AI Studio
  downloadButton: {
    strategies: [
      // Strategy 1: Look inside the bottom playback/action bar (Google AI Studio Speech runner bar)
      () => {
        const bottomBars = Array.from(document.querySelectorAll('footer, .bottom-bar, .playback-bar, .audio-player, ms-prompt-run-bar, ms-run-button, [class*="prompt-run-bar"], [class*="playback"]'));
        for (const bar of bottomBars) {
          if (bar.closest('#ai-tts-automation-dock')) continue;
          const buttons = Array.from(bar.querySelectorAll('button, [role="button"], a[download]'));
          const found = buttons.find((b) => {
            if (b.closest('#ai-tts-automation-dock')) return false;
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const title = (b.getAttribute('title') || '').toLowerCase();
            const tooltip = (b.getAttribute('mattooltip') || '').toLowerCase();
            const inner = b.innerHTML.toLowerCase();
            const icon = b.querySelector('mat-icon, svg');
            const iconText = (icon?.textContent || '').trim().toLowerCase();
            const isMatch = (
              aria.includes('download') ||
              aria.includes('unduh') ||
              title.includes('download') ||
              title.includes('unduh') ||
              tooltip.includes('download') ||
              tooltip.includes('unduh') ||
              iconText === 'download' ||
              iconText === 'file_download' ||
              iconText === 'arrow_downward' ||
              iconText === 'save_alt' ||
              iconText === 'get_app' ||
              inner.includes('download') ||
              b.hasAttribute('download')
            );
            return isMatch && window.AI_STUDIO_SELECTORS.isElementVisible(b);
          });
          if (found) return found;
        }
        return null;
      },
      // Strategy 2: Button with mat-icon, SVG, or text for download/file_download anywhere in viewport
      () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[download]'));
        return buttons.find((b) => {
          if (b.closest('#ai-tts-automation-dock')) return false;
          const icon = b.querySelector('mat-icon, svg, [class*="icon"]');
          const iconText = (icon?.textContent || '').trim().toLowerCase();
          const iconClass = (icon?.getAttribute('class') || '').toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          const tooltip = (b.getAttribute('mattooltip') || '').toLowerCase();
          const text = (b.innerText || '').toLowerCase();
          const isDownloadIcon = (
            iconText === 'download' ||
            iconText === 'file_download' ||
            iconText === 'arrow_downward' ||
            iconText === 'save_alt' ||
            iconText === 'get_app' ||
            iconClass.includes('download') ||
            aria.includes('download') ||
            aria.includes('unduh') ||
            title.includes('download') ||
            title.includes('unduh') ||
            tooltip.includes('download') ||
            text === 'download' ||
            text === 'unduh' ||
            b.hasAttribute('download')
          );
          return isDownloadIcon && window.AI_STUDIO_SELECTORS.isElementVisible(b);
        }) || null;
      },
      // Strategy 3: Action bar button near the play/duration audio controls (as visible in bottom player)
      () => {
        const iconBtns = Array.from(document.querySelectorAll('button'));
        return iconBtns.find((b) => {
          if (b.closest('#ai-tts-automation-dock')) return false;
          const rect = b.getBoundingClientRect();
          // Must be positioned near bottom of viewport
          if (rect.bottom < window.innerHeight - 200 || rect.top < window.innerHeight - 250) return false;
          const html = b.innerHTML.toLowerCase();
          const isMatch = (
            html.includes('download') ||
            html.includes('m19 9h-4v3h-2v-3h-4l5-5 5 5z') ||
            html.includes('path d="m5 20h14v-2h-14v2zm7-18') ||
            html.includes('file_download')
          );
          return isMatch && window.AI_STUDIO_SELECTORS.isElementVisible(b);
        }) || null;
      }
    ]
  },

  // Run comprehensive diagnostic inspection
  runDiagnostics: function() {
    const results = {
      timestamp: Date.now(),
      url: window.location.href,
      textInputFound: false,
      runButtonFound: false,
      generatingActive: false,
      audioOutputFound: false,
      details: {}
    };

    for (let i = 0; i < this.textInput.strategies.length; i++) {
      try {
        const el = this.textInput.strategies[i]();
        if (el) {
          results.textInputFound = true;
          results.details.textInput = { strategyIndex: i, tag: el.tagName, className: el.className };
          break;
        }
      } catch (e) {}
    }

    for (let i = 0; i < this.runButton.strategies.length; i++) {
      try {
        const el = this.runButton.strategies[i]();
        if (el) {
          results.runButtonFound = true;
          results.details.runButton = { strategyIndex: i, tag: el.tagName, text: el.innerText };
          break;
        }
      } catch (e) {}
    }

    for (let i = 0; i < this.generatingIndicator.strategies.length; i++) {
      try {
        const el = this.generatingIndicator.strategies[i]();
        if (el) {
          results.generatingActive = true;
          results.details.generatingIndicator = { strategyIndex: i, tag: el.tagName };
          break;
        }
      } catch (e) {}
    }

    for (let i = 0; i < this.audioOutput.strategies.length; i++) {
      try {
        const el = this.audioOutput.strategies[i]();
        if (el) {
          results.audioOutputFound = true;
          results.details.audioOutput = { strategyIndex: i, tag: el.tagName, src: el.src || el.getAttribute('href') };
          break;
        }
      } catch (e) {}
    }

    return results;
  }
};
