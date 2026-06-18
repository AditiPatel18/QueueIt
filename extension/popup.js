document.addEventListener('DOMContentLoaded', async () => {
    const titleInput = document.getElementById('title');
    const urlInput = document.getElementById('url');
    const sourceNameEl = document.getElementById('source-name');
    const readTimeEl = document.getElementById('read-time');
    const statusBadge = document.getElementById('status-badge');
    const saveBtn = document.getElementById('save-btn');
    const btnText = document.getElementById('btn-text');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    const successOverlay = document.getElementById('success-overlay');

    let currentUrl = '';
    let currentType = 'article';

    // Helper: show error
    const showError = (msg) => {
        errorMessage.textContent = msg;
        errorContainer.classList.remove('hidden');
        saveBtn.disabled = false;
        btnText.textContent = "Try Again";
    };

    // Helper: detect type
    const detectType = (url) => {
        if (url.includes('youtube.com') || url.includes('youtu.be')) return 'video';
        if (url.includes('twitter.com') || url.includes('x.com')) return 'tweet';
        if (url.includes('reddit.com')) return 'reddit';
        if (url.includes('github.com')) return 'github';
        return 'article';
    };

    // 1. Get current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
            showError("Cannot access current tab.");
            return;
        }

        currentUrl = activeTab.url;
        currentType = detectType(currentUrl);
        urlInput.value = currentUrl;

        statusBadge.textContent = currentType;
        if (currentType === 'video') statusBadge.style.color = '#ef4444';
        else if (currentType === 'tweet') statusBadge.style.color = '#3b82f6';
        else if (currentType === 'github') statusBadge.style.color = '#a1a1aa';

        // Ping content script
        chrome.tabs.sendMessage(activeTab.id, { action: "getPageInfo" }, (response) => {
            saveBtn.disabled = false;
            btnText.textContent = "Save to Queue";

            if (chrome.runtime.lastError || !response) {
                // Fallback if content script fails (e.g. on chrome:// pages)
                titleInput.value = activeTab.title || "";
                sourceNameEl.textContent = new URL(currentUrl).hostname.replace('www.', '');
                readTimeEl.textContent = "~1 min read";
                return;
            }

            // After receiving response from content script
            let extractedTitle = response.title;
            // If response title is missing or generic (e.g., "YouTube"), fallback to tab title
            if (!extractedTitle || extractedTitle.trim() === "YouTube") {
              extractedTitle = activeTab.title;
            }
            // Strip common suffixes like " - YouTube"
            if (extractedTitle && extractedTitle.includes(" - YouTube")) {
              extractedTitle = extractedTitle.replace(" - YouTube", "").trim();
            }
            // Populate fields
            titleInput.value = extractedTitle || "";
            sourceNameEl.textContent = response.siteName || new URL(currentUrl).hostname.replace('www.', '');
            readTimeEl.textContent = `~${response.estimatedReadTime || 1} min read`;
        });
    });

    // 2. Fetch auth token from localhost cookies
    const getAuthToken = async () => {
        return new Promise((resolve) => {

            chrome.cookies.getAll({}, (cookies) => {

                const authCookie = cookies.find(
                    c => c.name === "sb-xgifnzhpfexksoxavcyc-auth-token"
                );

                if (!authCookie) {
                    console.error("Auth cookie not found");
                    return resolve(null);
                }

                try {
                    let value = authCookie.value;

                    if (value.startsWith("base64-")) {
                        value = atob(value.substring(7));
                    }

                    const parsed = JSON.parse(value);

                    if (parsed.access_token) {
                        console.log("Access token extracted");
                        console.log("TOKEN:", parsed.access_token);
                        alert(parsed.access_token.substring(0, 50));
                        return resolve(parsed.access_token);
                    }

                    console.error("No access token found");
                    resolve(null);

                } catch (err) {
                    console.error("Token parse error:", err);
                    resolve(null);
                }
            });

        });
    };
    // 3. Handle save
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        btnText.textContent = "Saving...";
        errorContainer.classList.add('hidden');

        try {
            const token = await getAuthToken();
            if (!token) {
                showError("Please log in to QueueIt first (localhost:3000)");
                return;
            }

            const response = await fetch("http://localhost:8000/api/items", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    url: urlInput.value,
                    title: titleInput.value || undefined
                })
            });

            if (!response.ok) {
                let errMessage = "Failed to save content";
                try {
                    const errData = await response.json();
                    errMessage = errData.detail || errData.error || errMessage;
                } catch (e) { }
                throw new Error(errMessage);
            }

            // Success
            successOverlay.classList.remove('hidden');
            setTimeout(() => {
                window.close();
            }, 1500);

        } catch (error) {
            showError(error.message);
        }
    });
});
