// Get references to the UI elements
const startButton = document.getElementById('startRecording');
const stopButton = document.getElementById('stopRecording');
const captureButton = document.getElementById('captureSource');
const statusDisplay = document.getElementById('status');

// Function to update the UI based on the recording state
function updateUI(isRecording) {
    statusDisplay.textContent = `Status: ${isRecording ? 'Recording...' : 'Idle'}`;
    startButton.disabled = isRecording;
    stopButton.disabled = !isRecording;
    captureButton.disabled = !isRecording; // Also control the new button's state
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
            // Revert status message after a short delay
            setTimeout(() => {
                chrome.storage.local.get('isRecording', (data) => {
                    updateUI(data.isRecording || false);
                });
            }, 1500);
        }
    });
});


// On popup open, get the current recording state and update the UI
chrome.storage.local.get('isRecording', (data) => {
    updateUI(data.isRecording || false);
});
