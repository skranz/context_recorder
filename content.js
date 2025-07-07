// This script is injected into the web page to record actions.

(function() {
    // Ensure the script doesn't run multiple times
    if (window.hasAiRecorder) return;
    window.hasAiRecorder = true;

    let stepCounter = 0;

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

    // ==================================================================
    // NEW: CONSOLE & ERROR INTERCEPTION
    // ==================================================================

    // --- Intercept Console Messages ---
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
    };

    function formatConsoleArgs(args) {
        // Simple serialization for console arguments
        return args.map(arg => {
            if (arg instanceof Error) {
                return arg.stack || arg.message;
            }
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return '[Unserializable Object]';
                }
            }
            return String(arg);
        });
    }

    Object.keys(originalConsole).forEach(level => {
        console[level] = (...args) => {
            logStep(`CONSOLE_${level.toUpperCase()}`, {
                messages: formatConsoleArgs(args),
            });
            // Call the original console function to maintain browser behavior
            originalConsole[level].apply(console, args);
        };
    });

    // --- Intercept Uncaught Exceptions ---
    window.onerror = function(message, source, lineno, colno, error) {
        logStep('CONSOLE_ERROR', {
            errorType: 'Uncaught Exception',
            message: message,
            source: source,
            lineno: lineno,
            colno: colno,
            stack: error ? error.stack : 'No stack available.',
        });
        // Return false to allow the default browser error handler to run
        return false;
    };

    // ==================================================================
    // EXISTING LOGIC (WITH MINOR UPDATES)
    // ==================================================================

    // --- Utility function to generate a CSS Path for an element ---
    function getCssPath(element) {
        if (!(element instanceof Element)) return;
        const path = [];
        let currentElement = element;
        while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
            let selector = currentElement.nodeName.toLowerCase();
            if (currentElement.id) {
                selector = `#${currentElement.id}`;
                path.unshift(selector);
                break; // ID is unique, so we can stop.
            } else {
                const classNames = Array.from(currentElement.classList).filter(c => c).map(c => `.${c}`).join('');
                selector += classNames;
                let sibling = currentElement;
                let nth = 1;
                while ((sibling = sibling.previousElementSibling)) {
                    if (sibling.nodeName.toLowerCase() === currentElement.nodeName.toLowerCase()) {
                        nth++;
                    }
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

    // --- Utility function to serialize a mutation record ---
    function serializeMutation(mutation) {
        const serialized = {
            type: mutation.type,
        };
        if (mutation.type === 'childList') {
            serialized.addedNodes = Array.from(mutation.addedNodes).map(node => node.outerHTML || node.textContent);
            serialized.removedNodes = Array.from(mutation.removedNodes).map(node => node.outerHTML || node.textContent);
        } else if (mutation.type === 'attributes') {
            serialized.attributeName = mutation.attributeName;
            serialized.oldValue = mutation.oldValue;
            serialized.newValue = mutation.target.getAttribute(mutation.attributeName);
        }
        serialized.target = getCssPath(mutation.target); // Use CSS path for target
        return serialized;
    }

    // --- MutationObserver Setup ---
    const observer = new MutationObserver((mutationsList) => {
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

    // --- Initial Page Load ---
    logStep('PAGE_LOAD', {
        title: document.title,
        htmlSnapshot: document.documentElement.outerHTML
    });

    // --- User Action Listener (Clicks) ---
    document.addEventListener('click', (event) => {
        const cssPath = getCssPath(event.target);
        logStep('USER_ACTION_CLICK', {
            targetElement: event.target.outerHTML,
            cssPath: cssPath
        });
    }, true);

    // --- Listen for messages from the background script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === 'capturePageSource') {
            logStep('MANUAL_SNAPSHOT', {
                title: document.title,
                htmlSnapshot: document.documentElement.outerHTML
            });
            sendResponse({ status: 'captured' });
        }
    });

    console.log('AI Workflow Recorder content script is active.');
})();
