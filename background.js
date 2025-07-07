// State is managed in chrome.storage.local to be persistent
// across service worker restarts, as in-memory variables are not reliable.

// This function will be executed in the page's main world.
// It must be self-contained and not rely on any external variables.
function mainWorldScript() {
    // We need a way to send data back to the content script
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
        console[level] = function(...args) {
            dispatchEventToContentScript('CONSOLE', {
                level: level.toUpperCase(),
                messages: formatConsoleArgs(args)
            });
            original.apply(console, args);
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
                console.error("No active tab found.");
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
                console.log('Step logged:', request.data);
            }
        });
    } else if (request.command === 'capturePageSource') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { command: 'capturePageSource' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Could not send message to capture source: ', chrome.runtime.lastError.message);
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

// Helper function to inject all scripts and then initialize the content script
async function injectAndInitialize(tabId) {
    try {
        // 1. Inject the content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });

        // 2. Inject the main world script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: mainWorldScript,
            world: 'MAIN'
        });

        // 3. Get settings and send initialize message to content script
        const settings = await chrome.storage.local.get('recordMutations');
        await chrome.tabs.sendMessage(tabId, {
            command: 'initialize',
            settings: {
                recordMutations: settings.recordMutations || false
            }
        });

        console.log('All scripts injected and initialized successfully.');
    } catch (err) {
        console.error(`Failed to inject/initialize scripts: ${err}`);
        throw err;
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
        chrome.storage.local.get('isRecording', (data) => {
            if (data.isRecording) {
                injectAndInitialize(tabId).catch(err => {
                    console.error(`Failed to inject script on navigation: ${err}`);
                });
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
