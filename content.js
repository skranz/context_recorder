// This script is injected into the web page to record actions.

(function() {
    // Ensure the script doesn't run multiple times
    if (window.hasAiRecorder) return;
    window.hasAiRecorder = true;

    let stepCounter = 0;
    let observer;

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

    // --- Listen for events dispatched from the main-world script ---
    window.addEventListener('__ai_recorder_event__', (event) => {
        const { type, data } = event.detail;
        if (type === 'CONSOLE') {
            logStep(`CONSOLE_${data.level}`, { messages: data.messages });
        } else if (type === 'ERROR') {
            logStep('CONSOLE_ERROR', data);
        }
    }, false);

    // --- Utility function to generate a CSS Path ---
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

    // --- Utility function to serialize a mutation record ---
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

    // --- MutationObserver Management ---
    function setupMutationObserver() {
        if (observer) observer.disconnect();

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
    }

    // --- Initial Page Load ---
    logStep('PAGE_LOAD', {
        title: document.title,
    });

    // --- User Action Listener (Clicks) ---
    document.addEventListener('click', (event) => {
        logStep('USER_ACTION_CLICK', {
            targetElement: event.target.outerHTML,
            cssPath: getCssPath(event.target)
        });
    }, true);

    // --- User Action Listener (Input & Textarea Blur) ---
    // Records the value of text-based inputs and textareas when they lose focus.
    document.addEventListener('blur', (event) => {
        const target = event.target;
        const isTextInput = target.tagName === 'INPUT' && /^(text|password|search|email|url|tel|number|date|time|datetime-local|month|week)$/i.test(target.type);
        const isTextArea = target.tagName === 'TEXTAREA';

        if (isTextInput || isTextArea) {
            logStep('USER_ACTION_INPUT', {
                targetElement: target.outerHTML,
                cssPath: getCssPath(target),
                value: target.value
            });
        }
    }, true);

    // --- User Action Listener (Changes) ---
    // Records changes for checkboxes, radio buttons, and select dropdowns.
    document.addEventListener('change', (event) => {
        const target = event.target;
        if (target.tagName === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio')) {
            logStep('USER_ACTION_CHANGE', {
                targetElement: target.outerHTML,
                cssPath: getCssPath(target),
                value: target.value,
                checked: target.checked
            });
        } else if (target.tagName === 'SELECT') {
            const selectedOption = target.options[target.selectedIndex];
            logStep('USER_ACTION_CHANGE', {
                targetElement: target.outerHTML,
                cssPath: getCssPath(target),
                value: target.value,
                selectedText: selectedOption ? selectedOption.text : ''
            });
        }
    }, true);

    // --- Listen for messages from the background script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === 'initialize') {
            // This is a synchronous command. We don't need to send a response.
            // Just configure the script instance.
            if (request.settings.recordMutations) {
                setupMutationObserver();
            }
            // Do NOT return true here, as we are not calling sendResponse.
        } else if (request.command === 'capturePageSource') {
            // This command REQUIRES an asynchronous response.
            logStep('MANUAL_SNAPSHOT', {
                title: document.title,
                htmlSnapshot: document.documentElement.outerHTML
            });
            sendResponse({ status: 'captured' });
            // Return true to indicate we will send a response asynchronously.
            return true;
        }
    });

})();
