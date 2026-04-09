# ClearView 🚀
**Track time, run pomodoros, and stay focused.**

ClearView is a lightweight Chrome extension designed to help you reclaim your productivity. By automatically logging the time you spend on different websites and providing a built-in Pomodoro timer, it gives you the data you need to optimize your workflow and eliminate distractions.

## ✨ Features

- **Automated Time Tracking**: Automatically detects your active tab and logs how much time you spend on specific domains.
- **Smart Idle Detection**: Uses Chrome's Idle API to pause tracking when you step away from your computer, ensuring your data is 100% accurate.
- **Pomodoro Timer**: Integrated focus sessions with customizable work and break intervals.
- **Daily & Weekly Analytics**: View your productivity trends with local data storage.
- **Privacy First**: All browsing data is stored locally on your machine. We never see your history, and we never sell your data.

## 🛠️ Installation (Development Mode)

Since this extension is in development, you can load it locally:

1. Clone this repository or download the ZIP file.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the root folder of this project.

## 📂 Project Structure

```text
.
├── manifest.json          # Extension configuration & permissions
├── background/
│   └── background.js      # Core logic for tracking, alarms, and storage
├── popup/
│   ├── popup.html         # The main UI of the extension
│   └── popup.js           # Logic for the UI and timer display
└── icons/                 # Extension icons (16x16, 48x48, 128x128)
