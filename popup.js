// Get references to the UI elements
const startButton = document.getElementById('startRecording');
const stopButton = document.getElementById('stopRecording');
const captureButton = document.getElementById('captureSource');
const mutationsCheckbox = document.getElementById('recordMutations');
const statusDisplay = document.getElementById('status');

// Function to update the UI based on the recording state
function updateUI(isRecording) {
    statusDisplay.textContent = `Status: ${isRecording ? 'Recording...' : 'Idle'}`;
    startButton.disabled = isRecording;
    stopButton.disabled = !isRecording;
    captureButton.disabled = !isRecording;
    // The mutations checkbox is always enabled to allow pre-configuration
}

// Add click listener for the start button
startButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'start' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            statusDisplay.textContent = 'Error starting recorder.';
            return;
        }
        if (response && response.status === 'recording') {
            updateUI(true);
        }
    });
});

// Add click listener for the stop button
stopButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'stop' }, (response) => {
         if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            statusDisplay.textContent = 'Error stopping recorder.';
            return;
        }
        if (response && response.status === 'stopped') {
            updateUI(false);
        }
    });
});

// Add click listener for the capture source button
captureButton.addEventListener('click', () => {
    statusDisplay.textContent = 'Capturing page source...';
    chrome.runtime.sendMessage({ command: 'capturePageSource' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            statusDisplay.textContent = 'Error capturing source.';
        } else if (response && response.status === 'captured') {
            statusDisplay.textContent = 'Page source captured!';
            setTimeout(() => {
                chrome.storage.local.get('isRecording', (data) => {
                    updateUI(data.isRecording || false);
                });
            }, 1500);
        }
    });
});

// Add change listener for the mutations checkbox
mutationsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ recordMutations: mutationsCheckbox.checked });
});

// On popup open, get the current state and update the UI
chrome.storage.local.get(['isRecording', 'recordMutations'], (data) => {
    updateUI(data.isRecording || false);
    // Set the checkbox state based on stored value, defaulting to false
    mutationsCheckbox.checked = data.recordMutations || false;
});
