import {
  AppStateSingleton,
  createError,
  customParseArgs as parseArgs,
  generateHelpText,
  log,
  simpleTemplate,
} from "../libs/core";
import { stripGarbageNewLines, validateFiles } from "../libs/LLM";
import type { Command } from "../libs/types";

export default class RdCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get options() {
    return {
      help: { type: "boolean", short: "h" },
      accessible: { type: "boolean", short: "a" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof RdCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof RdCommand).options,
    });

    const avgHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.rd,
        (this.constructor as typeof RdCommand).options,
      );
      log(helpText);
    };

    if (values.help) {
      avgHelp();
      return 0;
    }

    const sourcePath = positionals[1];
    if (!sourcePath) {
      avgHelp();
      throw createError(appState.s.e.lllm.sourceRequired, { code: "SOURCE_REQUIRED" });
    }
    await validateFiles(sourcePath);

    const file = Bun.file(sourcePath);

    function ePubLikeTemplate(
      pageData: typeof appState.s.m.c.rd,
      sourcePathLocal: string,
    ): string {
      const pageDataJSON = JSON.stringify(pageData);
      return `
<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pageData.title}</title>
    <style>
      :root {
        --bg-color: #f8f9fa; --reader-bg-color: #ffffff; --text-color: #212529;
        --header-bg-color: #f1f3f5; --header-text-color: #495057; --border-color: #e9ecef;
        --button-bg-color: #4361ee; --button-hover-bg-color: #3a56e0; --button-disabled-bg-color: #adb5bd;
        --button-text-color: #ffffff; --input-bg-color: #ffffff; --input-text-color: #212529;
        --input-border-color: #ced4da; --input-focus-border-color: #4361ee;
        --input-focus-shadow-color: rgba(67, 97, 238, 0.2); --info-text-color: #6c757d;
        --instructions-text-color: #868e96; --shadow-color: rgba(0, 0, 0, 0.1);
        --theme-toggle-hover-bg: rgba(0, 0, 0, 0.05);
        --reader-font-size: 1.0rem;
      }
      html[data-theme="dark"] {
        --bg-color: #121212; --reader-bg-color: #1e1e1e; --text-color: #e0e0e0;
        --header-bg-color: #2a2a2a; --header-text-color: #adb5bd; --border-color: #3a3a3a;
        --button-bg-color: #4f6dff; --button-hover-bg-color: #6983ff; --button-disabled-bg-color: #495057;
        --input-bg-color: #2a2a2a; --input-text-color: #e0e0e0; --input-border-color: #495057;
        --input-focus-border-color: #4f6dff; --input-focus-shadow-color: rgba(79, 109, 255, 0.3);
        --info-text-color: #adb5bd; --instructions-text-color: #868e96; --shadow-color: rgba(0, 0, 0, 0.3);
        --theme-toggle-hover-bg: rgba(255, 255, 255, 0.1);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        color: var(--text-color); background-color: var(--bg-color);
        height: 100vh; overflow: hidden;
        transition: background-color 0.3s ease, color 0.3s ease;
        padding: 20px; display: flex; justify-content: center; align-items: center;
      }
      .reader-container {
        height: 100%; width: 100%; max-width: 900px; display: flex; flex-direction: column;
        background-color: var(--reader-bg-color); border-radius: 10px;
        box-shadow: 0 4px 12px var(--shadow-color); overflow: hidden;
        transition: background-color 0.3s ease; position: relative;
      }
      .loading-overlay {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0,0,0,0.1); backdrop-filter: blur(2px);
        z-index: 100; display: flex; justify-content: center; align-items: center;
        color: var(--text-color); font-size: 1.2rem; display: none;
      }
      .loading-overlay.visible { display: flex; }
      .header, .navigation { flex-shrink: 0; position: relative; z-index: 10; }
      .header {
        padding: 4px 20px; background-color: var(--header-bg-color);
        border-bottom: 1px solid var(--border-color); display: flex;
        justify-content: space-between; align-items: center;
        transition: background-color 0.3s ease, border-color 0.3s ease;
      }
      .header h1 {
        font-size: 0.7rem; color: var(--header-text-color); font-weight: 500;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        max-width: calc(100% - 250px); transition: color 0.3s ease;
      }
      .header-controls { display: flex; align-items: center; gap: 10px; }
      .font-size-control select {
        -webkit-appearance: none; -moz-appearance: none; appearance: none;
        background-color: var(--input-bg-color); border: 1px solid var(--input-border-color);
        border-radius: 6px; padding: 6px 28px 6px 10px; font-size: 0.85rem;
        color: var(--input-text-color); cursor: pointer;
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
        background-position: right 0.5rem center; background-repeat: no-repeat;
        background-size: 1.25em 1.25em; transition: all 0.2s ease;
      }
      .font-size-control select:focus {
        outline: none; border-color: var(--input-focus-border-color);
        box-shadow: 0 0 0 3px var(--input-focus-shadow-color);
      }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      .theme-toggle {
        background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: var(--header-text-color); transition: background-color 0.2s ease;
      }
      .theme-toggle:hover { background-color: var(--theme-toggle-hover-bg); }
      .theme-toggle .icon { width: 20px; height: 20px; }
      .sun-icon { display: none; } .moon-icon { display: block; }
      html[data-theme="dark"] .sun-icon { display: block; } html[data-theme="dark"] .moon-icon { display: none; }
      
      .page-viewport {
        flex-grow: 1;
        overflow: hidden;
        position: relative;
        cursor: default;
      }
      #page-slider {
        display: flex;
        height: 100%;
        will-change: transform;
        transform: translateZ(0);
        transition: transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .page-content {
        flex-shrink: 0;
        height: 100%;
        padding: 20px 40px;
        overflow: hidden;
        font-family: Georgia, "Times New Roman", Times, serif;
        font-size: var(--reader-font-size);
        line-height: 1.8;
        white-space: pre-wrap;
        word-break: break-word;
        text-align: justify;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .navigation {
        display: flex; justify-content: space-between; align-items: center; padding: 4px 40px;
        background-color: var(--bg-color); border-top: 1px solid var(--border-color);
        transition: background-color 0.3s ease, border-color 0.3s ease;
      }
      .page-controls { display: flex; align-items: center; gap: 15px; }
      button {
        background-color: var(--button-bg-color); color: var(--button-text-color); border: none;
        padding: 5px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
        font-weight: 500; transition: all 0.2s ease; display: flex; align-items: center; gap: 6px;
      }
      button:hover { background-color: var(--button-hover-bg-color); }
      button:disabled { background-color: var(--button-disabled-bg-color); cursor: not-allowed; }
      .page-input { display: flex; align-items: center; gap: 8px; }
      input[type="number"] {
        width: 70px; padding: 8px 10px; border: 1px solid var(--input-border-color);
        background-color: var(--input-bg-color); color: var(--input-text-color);
        border-radius: 6px; text-align: center; font-size: 1rem; transition: all 0.2s ease;
      }
      input[type="number"]:focus {
        outline: none; border-color: var(--input-focus-border-color);
        box-shadow: 0 0 0 3px var(--input-focus-shadow-color);
      }
      .page-info { font-size: 1rem; color: var(--info-text-color); font-weight: 500; }
      .instructions { font-size: 0.85rem; color: var(--instructions-text-color); margin-top: 5px; }
      
      @media (max-width: 768px) {
        body { 
          padding: 0; 
          display: block;
          height: 100dvh;
        }
        .reader-container { 
          border-radius: 0; 
          height: 100%; 
        }
        .text-container, .page-content { padding: 20px; }
        .header {
          padding: 2px 15px;
        }
        .navigation {
          padding: 6px 10px;
          flex-direction: row;
          justify-content: center;
          gap: 0;
        }
        .instructions {
          display: none;
        }
        .page-controls {
          gap: 8px;
        }
        button {
        font-size: 0.75rem;
        padding: 4px 8px;
        }
        .page-info {
          font-size: 0.8rem;
        }
        .page-input {
          gap: 4px;
        }
        .page-input span {
          font-size: 0.75rem;
        }
        input[type="number"] {
          width: 50px;
          padding: 4px;
          font-size: 0.85rem;
        }
        .header h1 { max-width: calc(100% - 180px); }
      }
    </style>
  </head>
  <body>
    <div class="reader-container">
      <div class="loading-overlay" id="loading-overlay">Paginating...</div>
      <div class="header">
        <h1>${String(sourcePathLocal.split("/").pop())}</h1>
        <div class="header-controls">
           <div class="font-size-control">
            <label for="font-size-selector" class="sr-only">Font Size</label>
            <select id="font-size-selector">
              <option value="0.9rem">Small</option>
              <option value="1.0rem" selected>Normal</option>
              <option value="1.1rem">Medium</option>
              <option value="1.2rem">Medium-L</option>
              <option value="1.3rem">Large</option>
              <option value="1.5rem">X-Large</option>
            </select>
          </div>
          <div class="page-info" id="page-info" data-template="${pageData.pageInfo}">${pageData.pageInfoFallback}</div>
          <button id="theme-toggle" class="theme-toggle" title="Toggle theme">
            <svg class="icon sun-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.166 7.758a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" /></svg>
            <svg class="icon moon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 004.463-.949a.75.75 0 01.819.162l.805.805a.75.75 0 01-.162.819A10.5 10.5 0 0118 18a10.5 10.5 0 01-10.5-10.5c0-1.81.46-3.52 1.257-5.042l.805.805z" clip-rule="evenodd" /></svg>
          </button>
        </div>
      </div>
      <div class="page-viewport" id="page-viewport">
        <div id="page-slider"></div>
      </div>
      <div class="navigation">
        <div class="page-controls">
          <button id="prev-button" disabled>${pageData.previousBtn}</button>
          <div class="page-input">
            <span>${pageData.goToPage}</span>
            <input type="number" id="page-input" min="1" value="1" />
          </div>
          <button id="next-button">${pageData.nextBtn}</button>
        </div>
        <div class="instructions">${pageData.instructions}</div>
      </div>
    </div>
    <script>
      const pageData = ${pageDataJSON};
      const simpleTemplate = ${simpleTemplate.toString()};

      const pageViewport = document.getElementById('page-viewport');
      const pageSlider = document.getElementById('page-slider');
      const prevButton = document.getElementById('prev-button');
      const nextButton = document.getElementById('next-button');
      const pageInput = document.getElementById('page-input');
      const pageInfoElement = document.getElementById('page-info');
      const fontSizeSelector = document.getElementById('font-size-selector');
      const loadingOverlay = document.getElementById('loading-overlay');

      let currentPage = 1, totalPages = 1, pageStepWidth = 0;
      let fullText = '', pages = [];
      
      function setLoading(isLoading) {
        loadingOverlay.classList.toggle('visible', isLoading);
        document.body.style.pointerEvents = isLoading ? 'none' : 'auto';
      }

      async function initializeReader() {
        try {
          setLoading(true);
          const res = await fetch('/content');
          if (!res.ok) throw new Error('Content fetch failed');
          fullText = await res.text();
          await repaginateAndRender(1, false);
        } catch (err) {
          console.error('Failed to initialize reader:', err);
          pageSlider.innerHTML = '<div class="page-content" style="width:100%">' + (pageData.contentLoadError || 'Failed to load content.') + '</div>';
        } finally {
          setLoading(false);
        }
      }

      function findPreviousWordBoundary(text, index) {
        let i = index - 1;
        while (i > 0) {
            if (/\\s/.test(text[i])) {
                return i + 1;
            }
            i--;
        }
        return index;
      }

      async function paginate() {
        const tempPages = [];
        const viewportRect = pageViewport.getBoundingClientRect();
        if (viewportRect.width === 0 || viewportRect.height === 0) return [];
        
        pageStepWidth = viewportRect.width;

        const measuringDiv = document.createElement('div');
        measuringDiv.classList.add('page-content');
        Object.assign(measuringDiv.style, {
            position: 'absolute', top: '-9999px', left: '-9999px',
            width: \`\${pageStepWidth}px\`, height: \`\${viewportRect.height}px\`,
            visibility: 'hidden', 
            fontSize: fontSizeSelector.value,
        });
        document.body.appendChild(measuringDiv);

        let currentOffset = 0;
        let pageCount = 0;

        while (currentOffset < fullText.length) {
            let low = 0;
            let high = Math.min(fullText.length - currentOffset, 8000); 
            let bestFitEnd = 0;

            let textChunk = fullText.substring(currentOffset, currentOffset + high);
            measuringDiv.textContent = textChunk;

            while (measuringDiv.scrollHeight <= measuringDiv.clientHeight && (currentOffset + high) < fullText.length) {
                low = high;
                high = Math.min(fullText.length - currentOffset, high * 2);
                textChunk = fullText.substring(currentOffset, currentOffset + high);
                measuringDiv.textContent = textChunk;
            }
            
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (mid === 0) {
                    low = 1;
                    continue;
                }
                
                const testText = fullText.substring(currentOffset, currentOffset + mid);
                measuringDiv.textContent = testText;
                
                if (measuringDiv.scrollHeight <= measuringDiv.clientHeight) {
                    bestFitEnd = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            
            let pageEnd = findPreviousWordBoundary(fullText, currentOffset + bestFitEnd);
            
            if (pageEnd <= currentOffset) {
                pageEnd = currentOffset + bestFitEnd; 
            }
            
            const pageText = fullText.substring(currentOffset, pageEnd);
            tempPages.push(pageText);
            currentOffset = pageEnd;
            
            pageCount++;
            if (pageCount % 20 === 0) {
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
        }

        document.body.removeChild(measuringDiv);
        return tempPages;
      }
      
      function renderAllPages() {
        const frag = document.createDocumentFragment();
        for (const pageText of pages) {
            const pageElement = document.createElement('div');
            pageElement.className = 'page-content';
            pageElement.style.width = \`\${pageStepWidth}px\`;
            pageElement.textContent = pageText;
            frag.appendChild(pageElement);
        }
        pageSlider.innerHTML = '';
        pageSlider.appendChild(frag);
      }
      
      async function repaginateAndRender(targetPage = 1, smooth = true) {
        setLoading(true);
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        pages = await paginate();
        totalPages = pages.length > 0 ? pages.length : 1;
        
        renderAllPages();

        setLoading(false);

        currentPage = Math.max(1, Math.min(targetPage, totalPages));
        goToPage(currentPage, smooth);
      }

      function goToPage(pageNumber, smooth = true) {
        currentPage = Math.max(1, Math.min(Math.floor(pageNumber) || 1, totalPages));
        const tx = -((currentPage - 1) * pageStepWidth);
        
        pageSlider.style.transition = smooth ? 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
        pageSlider.style.transform = \`translate3d(\${tx}px, 0, 0)\`;
        
        updateUI();
      }

      function goToPreviousPage() { if (currentPage > 1) goToPage(currentPage - 1); }
      function goToNextPage() { if (currentPage < totalPages) goToPage(currentPage + 1); }

      function updateUI() {
        pageInput.value = currentPage; pageInput.max = totalPages;
        prevButton.disabled = currentPage <= 1; nextButton.disabled = currentPage >= totalPages;
        pageInfoElement.textContent = simpleTemplate(pageInfoElement.dataset.template, { currentPage, totalPages });
      }

      function setupEventListeners() {
        prevButton.addEventListener('click', goToPreviousPage);
        nextButton.addEventListener('click', goToNextPage);
        pageInput.addEventListener('change', (e) => goToPage(e.target.value));
        pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goToPage(pageInput.value); pageInput.blur(); } });

        document.getElementById('theme-toggle')?.addEventListener('click', () => {
          const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', newTheme);
        });
        
        fontSizeSelector.addEventListener('change', (e) => {
          document.documentElement.style.setProperty('--reader-font-size', e.target.value);
          repaginateAndRender(currentPage, false);
        });

        document.addEventListener('keydown', (e) => {
          if (document.activeElement?.tagName === 'INPUT') return;
          switch (e.key) {
            case 'ArrowLeft': case 'h': case 'H': e.preventDefault(); goToPreviousPage(); break;
            case 'ArrowRight': case 'l': case 'L': e.preventDefault(); goToNextPage(); break;
            case ' ': e.preventDefault(); e.shiftKey ? goToPreviousPage() : goToNextPage(); break;
          }
        }, { passive: false });
        
        let resizeTimer;
        window.addEventListener('resize', () => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => repaginateAndRender(currentPage, false), 250);
        }, { passive: true });
      }

      document.addEventListener('DOMContentLoaded', () => {
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light');
        setupEventListeners();
        initializeReader();
      });
    </script>
  </body>
</html>`;
    }

    function accessibleScrollerTemplate(
      content: string,
      pageData: typeof appState.s.m.c.rd,
      sourcePathLocal: string,
    ): string {
      return `
<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pageData.title}</title>
    <style>
      :root {
        --bg-color: #f8f9fa;
        --reader-bg-color: #ffffff;
        --text-color: #212529;
        --header-bg-color: #f1f3f5;
        --header-text-color: #495057;
        --border-color: #e9ecef;
        --button-bg-color: #4361ee;
        --button-hover-bg-color: #3a56e0;
        --button-disabled-bg-color: #adb5bd;
        --button-text-color: #ffffff;
        --input-bg-color: #ffffff;
        --input-text-color: #212529;
        --input-border-color: #ced4da;
        --input-focus-border-color: #4361ee;
        --input-focus-shadow-color: rgba(67, 97, 238, 0.2);
        --info-text-color: #6c757d;
        --instructions-text-color: #868e96;
        --shadow-color: rgba(0, 0, 0, 0.1);
        --theme-toggle-hover-bg: rgba(0, 0, 0, 0.05);
      }
      html[data-theme="dark"] {
        --bg-color: #121212;
        --reader-bg-color: #1e1e1e;
        --text-color: #e0e0e0;
        --header-bg-color: #2a2a2a;
        --header-text-color: #adb5bd;
        --border-color: #3a3a3a;
        --button-bg-color: #4f6dff;
        --button-hover-bg-color: #6983ff;
        --button-disabled-bg-color: #495057;
        --button-text-color: #ffffff;
        --input-bg-color: #2a2a2a;
        --input-text-color: #e0e0e0;
        --input-border-color: #495057;
        --input-focus-border-color: #4f6dff;
        --input-focus-shadow-color: rgba(79, 109, 255, 0.3);
        --info-text-color: #adb5bd;
        --instructions-text-color: #868e96;
        --shadow-color: rgba(0, 0, 0, 0.3);
        --theme-toggle-hover-bg: rgba(255, 255, 255, 0.1);
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        line-height: 1.6;
        color: var(--text-color);
        background-color: var(--bg-color);
        padding: 20px;
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        transition:
          background-color 0.3s ease,
          color 0.3s ease;
      }
      .reader-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
        background-color: var(--reader-bg-color);
        border-radius: 10px;
        box-shadow: 0 4px 12px var(--shadow-color);
        overflow: hidden;
        transition: background-color 0.3s ease;
      }
      .header {
        padding: 4px 20px;
        background-color: var(--header-bg-color);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition:
          background-color 0.3s ease,
          border-color 0.3s ease;
      }
      .header h1 {
        font-size: 0.7rem;
        color: var(--header-text-color);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: calc(100% - 250px);
        transition: color 0.3s ease;
      }
      .header-controls {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .font-size-control select {
        -webkit-appearance: none; -moz-appearance: none; appearance: none;
        background-color: var(--input-bg-color);
        border: 1px solid var(--input-border-color);
        border-radius: 6px;
        padding: 6px 28px 6px 10px;
        font-size: 0.85rem;
        color: var(--input-text-color);
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
        background-position: right 0.5rem center;
        background-repeat: no-repeat;
        background-size: 1.25em 1.25em;
        transition: all 0.2s ease;
      }
      .font-size-control select:focus {
        outline: none;
        border-color: var(--input-focus-border-color);
        box-shadow: 0 0 0 3px var(--input-focus-shadow-color);
      }
      .theme-toggle {
        background: none;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--header-text-color);
        transition: background-color 0.2s ease;
      }
      .theme-toggle:hover {
        background-color: var(--theme-toggle-hover-bg);
        transform: none;
      }
      .theme-toggle .icon {
        width: 20px;
        height: 20px;
      }
      .sun-icon { display: none; }
      .moon-icon { display: block; }
      html[data-theme="dark"] .sun-icon { display: block; }
      html[data-theme="dark"] .moon-icon { display: none; }
      .text-container {
        flex: 1;
        padding: 40px;
        overflow-y: auto;
        white-space: pre-wrap;
        font-size: 1.0rem;
        line-height: 1.8;
        font-family: Georgia, "Times New Roman", Times, serif;
        padding-bottom: 60px;
        -webkit-font-smoothing: antialiased;
      }
      .navigation {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 40px;
        background-color: var(--bg-color);
        border-top: 1px solid var(--border-color);
        transition:
          background-color 0.3s ease,
          border-color 0.3s ease;
      }
      .page-controls {
        display: flex;
        align-items: center;
        gap: 15px;
      }
      button {
        background-color: var(--button-bg-color);
        color: var(--button-text-color);
        border: none;
        padding: 5px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      button:hover {
        background-color: var(--button-hover-bg-color);
        transform: translateY(-1px);
      }
      button:disabled {
        background-color: var(--button-disabled-bg-color);
        cursor: not-allowed;
        transform: none;
      }
      .page-input {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      input[type="number"] {
        width: 70px;
        padding: 8px 10px;
        border: 1px solid var(--input-border-color);
        background-color: var(--input-bg-color);
        color: var(--input-text-color);
        border-radius: 6px;
        text-align: center;
        font-size: 1rem;
        transition: all 0.2s ease;
      }
      input[type="number"]:focus {
        outline: none;
        border-color: var(--input-focus-border-color);
        box-shadow: 0 0 0 3px var(--input-focus-shadow-color);
      }
      .page-info {
        font-size: 1rem;
        color: var(--info-text-color);
        font-weight: 500;
      }
      .instructions {
        font-size: 0.85rem;
        color: var(--instructions-text-color);
        margin-top: 5px;
      }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      @media (max-width: 768px) {
        body { 
          padding: 0; 
          display: block;
          height: 100dvh;
        }
        .reader-container { 
          border-radius: 0; 
          height: 100%; 
        }
        .text-container, .page-content { padding: 20px; }
        .header {
          padding: 2px 15px;
        }
        .navigation {
          padding: 6px 10px;
          flex-direction: row;
          justify-content: center;
          gap: 0;
        }
        .instructions {
          display: none;
        }
        .page-controls {
          gap: 8px;
        }
        button {
        font-size: 0.75rem;
        padding: 4px 8px;
        }
        .page-info {
          font-size: 0.8rem;
        }
        .page-input {
          gap: 4px;
        }
        .page-input span {
          font-size: 0.75rem;
        }
        input[type="number"] {
          width: 50px;
          padding: 4px;
          font-size: 0.85rem;
        }
        .header h1 { max-width: calc(100% - 180px); }
      }
    </style>
  </head>
  <body>
    <div class="sr-only" aria-live="polite" aria-atomic="true" id="page-change-announcer"></div>
    <div class="reader-container">
      <div class="header">
        <h1>${sourcePathLocal.split("/").pop()}</h1>
        <div class="header-controls">
          <div class="font-size-control">
            <label for="font-size-selector" class="sr-only">Font Size</label>
            <select id="font-size-selector">
              <option value="0.9rem">Small</option>
              <option value="1.0rem" selected>Normal</option>
              <option value="1.1rem">Medium</option>
              <option value="1.2rem">Medium-L</option>
              <option value="1.3rem">Large</option>
              <option value="1.5rem">X-Large</option>
            </select>
          </div>
          <div class="page-info" id="page-info" data-template="${pageData.pageInfo}">
            ${pageData.pageInfoFallback}
          </div>
          <button id="theme-toggle" class="theme-toggle" title="Toggle theme">
            <svg class="icon sun-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.166 7.758a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
            </svg>
            <svg class="icon moon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 004.463-.949a.75.75 0 01.819.162l.805.805a.75.75 0 01-.162.819A10.5 10.5 0 0118 18a10.5 10.5 0 01-10.5-10.5c0-1.81.46-3.52 1.257-5.042l.805.805z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
      <div class="text-container" id="text-container"></div>
      <div class="navigation">
        <div class="page-controls">
          <button id="prev-button" disabled>${pageData.previousBtn}</button>
          <div class="page-input">
            <span>${pageData.goToPage}</span
            ><input type="number" id="page-input" min="1" value="1" />
          </div>
          <button id="next-button">${pageData.nextBtn}</button>
        </div>
        <div class="instructions">${pageData.instructions2}</div>
      </div>
    </div>
    <script>
      const fullText = ${JSON.stringify(content)};
      const textContainer = document.getElementById('text-container'), prevButton = document.getElementById('prev-button'), announcer = document.getElementById('page-change-announcer');
      const nextButton = document.getElementById('next-button'), pageInput = document.getElementById('page-input'), pageInfoElement = document.getElementById('page-info');
      let lines = [], linesPerPage = 0, currentPage = 1, totalPages = 1;
      const scrollAmount = 50, simpleTemplate = ${simpleTemplate.toString()};

      function initReader() {
        lines = fullText.split('\\n').filter(line => line.trim() !== '' || line.length > 0);
        calculateLinesPerPage(); renderPage(); setupEventListeners();
      }
      function calculateLinesPerPage() {
        const testLine = document.createElement('div'); testLine.textContent = 'Test';
        testLine.style.cssText = 'visibility:hidden;position:absolute;padding:0 40px;'; document.body.appendChild(testLine);
        const lineHeight = parseFloat(window.getComputedStyle(testLine).height); document.body.removeChild(testLine);
        linesPerPage = Math.max(1, Math.floor(textContainer.clientHeight / (lineHeight || 16)));
        totalPages = Math.max(1, Math.ceil(lines.length / linesPerPage));
        currentPage = Math.max(1, Math.min(currentPage, totalPages));
        updatePageInfo();
      }
      function renderPage() {
        const pageLines = lines.slice((currentPage - 1) * linesPerPage, Math.min(currentPage * linesPerPage, lines.length));
        textContainer.innerHTML = pageLines.map(line => line.trim() === '' ? '<br>' : line.replace(/^ +/, (m) => '&nbsp;'.repeat(m.length))).join('<br>');
        prevButton.disabled = currentPage === 1; nextButton.disabled = currentPage >= totalPages;
        pageInput.value = currentPage; updatePageInfo(); textContainer.scrollTop = 0;
        
        if (announcer) {
          announcer.textContent = simpleTemplate(pageInfoElement.dataset.template, { currentPage, totalPages: totalPages || 1 });
        }
      }
      function updatePageInfo() {
        pageInfoElement.textContent = simpleTemplate(pageInfoElement.dataset.template, { currentPage, totalPages: totalPages || 1 });
      }
      function goToPage(pageNumber) {
        currentPage = Math.max(1, Math.min(parseInt(pageNumber) || 1, totalPages)); renderPage();
      }
      function goToPreviousPage() { if (currentPage > 1) { currentPage--; renderPage(); } }
      function goToNextPage() { if (currentPage < totalPages) { currentPage++; renderPage(); } }

      function setupEventListeners() {
        prevButton.addEventListener('click', goToPreviousPage); nextButton.addEventListener('click', goToNextPage);
        pageInput.addEventListener('change', (e) => goToPage(e.target.value));
        pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goToPage(pageInput.value); });
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
          document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        });
        document.getElementById('font-size-selector').addEventListener('change', (e) => {
          textContainer.style.fontSize = e.target.value;
          calculateLinesPerPage();
          renderPage();
        });
        document.addEventListener('keydown', (e) => {
          if (document.activeElement.tagName === 'INPUT') return;
          e.preventDefault();
          if (e.key === ' ') e.shiftKey ? textContainer.scrollTop -= textContainer.clientHeight : textContainer.scrollTop += textContainer.clientHeight;
          else if (['ArrowLeft', 'h', 'H'].includes(e.key)) goToPreviousPage();
          else if (['ArrowRight', 'l', 'L'].includes(e.key)) goToNextPage();
          else if (['k', 'K'].includes(e.key)) textContainer.scrollTop -= scrollAmount;
          else if (['j', 'J'].includes(e.key)) textContainer.scrollTop += scrollAmount;
        });
        let resizeTimeout;
        window.addEventListener('resize', () => {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => { calculateLinesPerPage(); renderPage(); }, 200);
        });
      }

      document.addEventListener('DOMContentLoaded', () => {
        const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light');
        initReader();
      });
    </script>
  </body>
</html>`;
    }

    if (values.accessible) {
      const rawText = await file.text();
      const cleaned = stripGarbageNewLines(rawText, true);
      log(appState.s.m.c.rd.ebookLoaded);

      const server = Bun.serve({
        port: 33636,
        fetch(req, server) {
          const url = new URL(req.url);

          if (url.pathname === "/") {
            setTimeout(() => {
              log(appState.s.m.c.rd.serverShutdown);
              server.stop();
            }, 20000);

            return new Response(
              accessibleScrollerTemplate(cleaned, appState.s.m.c.rd, sourcePath),
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          }

          if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 204 });
          }

          return new Response(appState.s.m.c.rd.notFound, { status: 404 });
        },
      });

      log(simpleTemplate(appState.s.m.c.rd.serverRunningAt, { url: server.url.toString() }));
      log(simpleTemplate(appState.s.m.c.rd.readingFile, { sourcePath }));
      log(appState.s.m.c.rd.instructions2);
    } else {
      const rawText = await file.text();
      const cleaned = stripGarbageNewLines(rawText, true);
      const blob = new Blob([cleaned], { type: "text/plain; charset=utf-8" });
      log(appState.s.m.c.rd.ebookLoaded);

      const server = Bun.serve({
        port: 33636,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/") {
            setTimeout(() => {
              log(appState.s.m.c.rd.serverShutdown);
              server.stop();
            }, 20000);

            return new Response(ePubLikeTemplate(appState.s.m.c.rd, sourcePath), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          if (url.pathname === "/content") {
            try {
              return new Response(blob.stream(), {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              });
            } catch (err) {
              return new Response(String(err), { status: 500 });
            }
          }

          if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 204 });
          }

          return new Response(appState.s.m.c.rd.notFound, { status: 404 });
        },
      });

      log(simpleTemplate(appState.s.m.c.rd.serverRunningAt, { url: server.url.toString() }));
      log(simpleTemplate(appState.s.m.c.rd.readingFile, { sourcePath }));
      log(appState.s.m.c.rd.instructions);
    }

    return 0;
  }
}
