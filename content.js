// This script is injected into the web page to record actions.

(function() {
    // Ensure the script doesn't run multiple times
    if (window.hasAiRecorder) return;
    window.hasAiRecorder = true;

    // --- SCRIPT TO INJECT INTO THE MAIN WORLD ---
    // This script runs in the page's own context, allowing it to
    // patch console and window.onerror for the page's scripts.
    function injectPageScript() {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                // We need a way to send data back to the content script
                function dispatchEventToContentScript(type, data) {
                    const detail = { type, data };
                    window.dispatchEvent(new CustomEvent('__ai_recorder_event__', { detail }));
                }

                // --- Helper function to format console arguments ---
                function formatConsoleArgs(args) {
                    return Array.from(args).map(arg => {
                        if (arg instanceof Error) { return arg.stack || arg.message; }
                        if (typeof arg === 'object' && arg !== null) {
                            try { return JSON.stringify(arg); }
                            catch (e) { return '[Unserializable Object]'; }
                        }
                        return String(arg);
                    });
                }

                // --- Intercept Page's Console Messages ---
                const consoleLevels = ['log', 'warn', 'error', 'info'];
                consoleLevels.forEach(level => {
                    const original = console[level];
                    console[level] = function(...args) {
                        dispatchEventToContentScript('CONSOLE', {
                            level: level.toUpperCase(),
                            messages: formatConsoleArgs(args)
                        });
                        original.apply(console, args);
                    };
                });

                // --- Intercept Page's Uncaught Errors ---
                const originalOnError = window.onerror;
                window.onerror = function(message, source, lineno, colno, error) {
                    dispatchEventToContentScript('ERROR', {
                        errorType: 'Uncaught Exception',
                        message,
                        source,
                        lineno,
                        colno,
                        stack: error ? error.stack : 'No stack available.'
                    });
                    if (originalOnError) {
                        // Call previous handler if it existed
                        return originalOnError.apply(window, arguments);
                    }
                    return false; // Let the default handler run
                };
            })();
        `;
        // Inject the script into the page's head and then remove it.
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }


    // --- MAIN CONTENT SCRIPT LOGIC (ISOLATED WORLD) ---

    let stepCounter = 0;
    let observer; // Keep the observer in a broader scope

    // --- Log a step to the background script ---
    function logStep(type, data) {
        stepCounter++;
        const stepData = {
            step: stepCounter,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            type: type,
            ...data
        };
        chrome.runtime.sendMessage({ command: 'logStep', data: stepData });
    }

    // --- Listen for events dispatched from the injected page script ---
    window.addEventListener('__ai_recorder_event__', (event) => {
        const { type, data } = event.detail;
        if (type === 'CONSOLE') {
            logStep(`CONSOLE_${data.level}`, { messages: data.messages });
        } else if (type === 'ERROR') {
            logStep('CONSOLE_ERROR', data);
        }
    }, false);

    // --- Intercept Console Messages & Errors (from THIS content script) ---
    // This is kept to log events originating from the content script itself.
    const originalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    function formatConsoleArgs(args) {
        return args.map(arg => {
            if (arg instanceof Error) { return arg.stack || arg.message; }
            if (typeof arg === 'object' && arg !== null) { try { return JSON.stringify(arg); } catch (e) { return '[Unserializable Object]'; } }
            return String(arg);
        });
    }
    Object.keys(originalConsole).forEach(level => {
        console[level] = (...args) => {
            logStep(`CONSOLE_${level.toUpperCase()}`, { messages: formatConsoleArgs(args) });
            originalConsole[level].apply(console, args);
        };
    });
    window.onerror = function(message, source, lineno, colno, error) {
        logStep('CONSOLE_ERROR', { errorType: 'Uncaught Exception from Content Script', message, source, lineno, colno, stack: error ? error.stack : 'No stack available.' });
        return false;
    };

    // --- Utility function to generate a CSS Path (Unchanged) ---
    function getCssPath(element) {
        if (!(element instanceof Element)) return;
        const path = [];
        let currentElement = element;
        while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
            let selector = currentElement.nodeName.toLowerCase();
            if (currentElement.id) {
                selector = `#${currentElement.id}`;
                path.unshift(selector);
                break;
            } else {
                const classNames = Array.from(currentElement.classList).filter(c => c).map(c => `.${c}`).join('');
                selector += classNames;
                let sibling = currentElement;
                let nth = 1;
                while ((sibling = sibling.previousElementSibling)) {
                    if (sibling.nodeName.toLowerCase() === currentElement.nodeName.toLowerCase()) { nth++; }
                }
                if (currentElement.parentElement && currentElement.parentElement.querySelectorAll(selector).length > 1) {
                    selector += `:nth-of-type(${nth})`;
                }
            }
            path.unshift(selector);
            currentElement = currentElement.parentNode;
        }
        return path.join(' > ');
    }

    // --- Utility function to serialize a mutation record (Unchanged) ---
    function serializeMutation(mutation) {
        const serialized = { type: mutation.type };
        if (mutation.type === 'childList') {
            serialized.addedNodes = Array.from(mutation.addedNodes).map(node => node.outerHTML || node.textContent);
            serialized.removedNodes = Array.from(mutation.removedNodes).map(node => node.outerHTML || node.textContent);
        } else if (mutation.type === 'attributes') {
            serialized.attributeName = mutation.attributeName;
            serialized.oldValue = mutation.oldValue;
            serialized.newValue = mutation.target.getAttribute(mutation.attributeName);
        }
        serialized.target = getCssPath(mutation.target);
        return serialized;
    }

    // --- MutationObserver Management (Unchanged) ---
    function setupMutationObserver() {
        if (observer) observer.disconnect(); // Disconnect any existing observer

        observer = new MutationObserver((mutationsList) => {
            const serializedMutations = mutationsList.map(serializeMutation);
            if (serializedMutations.length > 0) {
                logStep('DOM_MUTATION', { mutations: serializedMutations });
            }
        });

        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeOldValue: true
        });
        console.log('Mutation observer is now active.');
    }

    function stopMutationObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
            console.log('Mutation observer has been stopped.');
        }
    }

    // Check initial setting for recording mutations
    chrome.storage.local.get('recordMutations', (data) => {
        if (data.recordMutations) {
            setupMutationObserver();
        }
    });

    // Listen for real-time changes to the setting
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes.recordMutations) {
            const shouldRecord = changes.recordMutations.newValue;
            if (shouldRecord) {
                setupMutationObserver();
            } else {
                stopMutationObserver();
            }
        }
    });

    // Inject the script to capture page-level events
    injectPageScript();

    // --- Initial Page Load (MODIFIED) ---
    // Removed htmlSnapshot to prevent message size issues.
    // Manual snapshots are available via the popup.
    logStep('PAGE_LOAD', {
        title: document.title
    });

    // --- User Action Listener (Clicks) (Unchanged) ---
    document.addEventListener('click', (event) => {
        logStep('USER_ACTION_CLICK', {
            targetElement: event.target.outerHTML,
            cssPath: getCssPath(event.target)
        });
    }, true);

    // --- Listen for messages from the background script (Unchanged) ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === 'capturePageSource') {
            logStep('MANUAL_SNAPSHOT', {
                title: document.title,
                htmlSnapshot: document.documentElement.outerHTML
            });
            sendResponse({ status: 'captured' });
        }
        // This listener needs to be able to respond asynchronously.
        return true;
    });

    console.log('AI Workflow Recorder content script is active.');
})();
