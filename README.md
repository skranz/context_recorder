# Context Recorder - Chrome Extensision

**UNFINISHED DEVELOPMENT VERSION**

The Context Recorder is a Chrome extension designed to capture a comprehensive record of a user's web session. It records user actions, page states, DOM mutations, and console activity, exporting the entire workflow into a structured JSON file. 

The goal is to generate context for AI prompts to build or debug new chrome extensions. 

It records more comprehensively than the included Chrome recorder.


## Key Features

-   **User Action Recording:** Logs every click, capturing the target element's HTML and a stable CSS selector path.
-   **Page State Snapshots:** Saves the full HTML of a page upon initial load, navigation, or on-demand via a "Store Page Source" button.
-   **Optional DOM Mutation Tracking:** A toggle allows you to record granular changes to the DOM (e.g., elements being added, removed, or modified) as they happen.
-   **Console Activity Logging:** Automatically captures `console.log`, `console.warn`, `console.error` messages, and uncaught JavaScript exceptions.
-   **Single File Export:** On stopping the recording, the entire captured session is available for download as a single, well-structured JSON file.

## How to Use

1.  **Install the Extension:** Load the extension into Chrome using the instructions below.
2.  **Open the Popup:** Click the extension's icon in the Chrome toolbar.
3.  **Configure Settings:**
    -   Check the **"Record Mutations"** box if you want to capture changes to the page's structure. It is off by default.
4.  **Start Recording:** Click the **"Start Recording"** button.
5.  **Interact with Web Pages:** Navigate, click, and perform the workflow you want to record.
    -   At any point, you can click **"Store Page Source"** to save a full snapshot of the current page.
6.  **Stop and Download:** Click the **"Stop Recording"** button. A "Save As" dialog will immediately appear, prompting you to save the `workflow-recording-....json` file.

## Installation

Since this is an unpacked extension, you can install it in developer mode:

1.  Download or clone this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions`.
3.  Enable **"Developer mode"** using the toggle switch in the top-right corner.
4.  Click the **"Load unpacked"** button.
5.  Select the folder where you saved the extension files.
6.  The "AI Workflow Recorder" will now be active in your browser.

## Understanding the JSON Output

The output file contains a `workflow` array, where each element is a "step" object. Each step has a `type` that defines its content.

### `PAGE_LOAD` or `MANUAL_SNAPSHOT`
Logged on page load or when "Store Page Source" is clicked.

```json
{
  "step": 1,
  "timestamp": "...",
  "url": "https://example.com/",
  "type": "PAGE_LOAD",
  "title": "Example Domain",
  "htmlSnapshot": "<!DOCTYPE html><html>...</html>"
}
```

### `USER_ACTION_CLICK`
Logged when the user clicks an element.

```json
{
  "step": 2,
  "timestamp": "...",
  "url": "https://example.com/",
  "type": "USER_ACTION_CLICK",
  "targetElement": "<button>Click Me</button>",
  "cssPath": "body > div.container > button:nth-of-type(1)"
}
```

### `DOM_MUTATION`
Logged if "Record Mutations" is active and the page changes.

```json
{
  "step": 3,
  "timestamp": "...",
  "url": "https://example.com/",
  "type": "DOM_MUTATION",
  "mutations": [
    {
      "type": "childList",
      "addedNodes": ["<div>New Content</div>"],
      "removedNodes": [],
      "target": "body > div#output-area"
    }
  ]
}
```

### `CONSOLE_LOG`, `CONSOLE_WARN`, `CONSOLE_ERROR`, etc.
Logged when a console message or error occurs on the page.

```json
{
  "step": 4,
  "timestamp": "...",
  "url": "https://example.com/",
  "type": "CONSOLE_ERROR",
  "errorType": "Uncaught Exception",
  "message": "Uncaught ReferenceError: nonExistentFunction is not defined",
  "source": "https://example.com/script.js",
  "lineno": 10,
  "colno": 5,
  "stack": "ReferenceError: nonExistentFunction is not defined at..."
}
```
