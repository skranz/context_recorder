// State is managed in chrome.storage.local to be persistent
// across service worker restarts, as in-memory variables are not reliable.

function mainWorldScript() {
    // This function patches the page's console and error handlers.
    // It's designed to run without interfering with the page's own functionality.
    function dispatchEventToContentScript(type, data) {
        const detail = { type, data };
        window.dispatchEvent(new CustomEvent('__ai_recorder_event__', { detail }));
    }

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

    const consoleLevels = ['log', 'warn', 'error', 'info'];
    consoleLevels.forEach(level => {
        const original = console[level];
        // The .bind() is crucial to maintain the correct 'this' context for the native console function.
        const boundOriginal = original.bind(console);
        console[level] = function(...args) {
            dispatchEventToContentScript('CONSOLE', {
                level: level.toUpperCase(),
                messages: formatConsoleArgs(args)
            });
            boundOriginal(...args);
        };
    });

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
            return originalOnError.apply(window, arguments);
        }
        return false;
    };
}


// --- Main Extension Logic ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'start') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                sendResponse({ status: 'error', message: 'No active tab found.' });
                return;
            }
            startRecording(tabs[0], sendResponse);
        });
        return true;
    } else if (request.command === 'stop') {
        stopRecording(sendResponse);
        return true;
    } else if (request.command === 'logStep') {
        chrome.storage.local.get(['isRecording', 'recordedSteps'], (data) => {
            if (data.isRecording) {
                const updatedSteps = data.recordedSteps || [];
                updatedSteps.push(request.data);
                chrome.storage.local.set({ recordedSteps: updatedSteps });
            }
        });
    } else if (request.command === 'capturePageSource') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { command: 'capturePageSource' }, (response) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                    } else {
                        sendResponse(response);
                    }
                });
            } else {
                sendResponse({ status: 'error', message: 'No active tab found.' });
            }
        });
        return true;
    }
});

async function injectAndInitialize(tabId) {
    try {
        // Inject scripts onto the page. This will run ASAP on an already loaded page.
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });

        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: mainWorldScript,
            world: 'MAIN'
        });

        const settings = await chrome.storage.local.get('recordMutations');
        chrome.tabs.sendMessage(tabId, {
            command: 'initialize',
            settings: {
                recordMutations: settings.recordMutations || false
            }
        });
        console.log('Scripts injected and initialized for tab:', tabId);
    } catch (err) {
        console.warn(`Could not inject scripts into tab ${tabId}: ${err.message}`);
        throw err; // Allow the caller to handle the error
    }
}

// This listener is for handling navigations that occur DURING a recording session.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Inject scripts when the new page is loading to catch as much as possible.
    if (changeInfo.status === 'loading') {
        chrome.storage.local.get('isRecording', (data) => {
            if (data.isRecording) {
                injectAndInitialize(tabId);
            }
        });
    }
});

function startRecording(tab, sendResponse) {
    chrome.storage.local.get('isRecording', (data) => {
        if (data.isRecording) {
            sendResponse({ status: 'already recording' });
            return;
        }
        // THE FIX: Set recording state, then inject scripts directly without reloading.
        chrome.storage.local.set({ isRecording: true, recordedSteps: [] }, () => {
            injectAndInitialize(tab.id).then(() => {
                sendResponse({ status: 'recording' });
            }).catch(err => {
                console.error('Failed to start recording due to injection error:', err);
                chrome.storage.local.set({ isRecording: false, recordedSteps: [] });
                sendResponse({ status: 'error', message: err.message });
            });
        });
    });
}

function stopRecording(sendResponse) {
    chrome.storage.local.get(['isRecording', 'recordedSteps'], (data) => {
        if (!data.isRecording) {
            sendResponse({ status: 'not recording' });
            return;
        }
        downloadRecording(data.recordedSteps);
        chrome.storage.local.set({ isRecording: false, recordedSteps: [] }, () => {
            console.log('Recording stopped and state cleared.');
            sendResponse({ status: 'stopped' });
        });
    });
}

function downloadRecording(recordedSteps) {
    if (!recordedSteps || recordedSteps.length === 0) {
        console.log('No steps were recorded.');
        return;
    }
    const jsonString = JSON.stringify({ workflow: recordedSteps }, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    chrome.downloads.download({
        url: dataUrl,
        filename: `workflow-recording.json`,
        saveAs: true
    }).catch(err => {
        console.error('Download failed:', err);
    });
}
