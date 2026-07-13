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

    const normalizeUrl = (urlStr) => {
        try {
            const url = new URL(urlStr);
            url.hash = '';
            if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
                url.pathname = url.pathname.slice(0, -1);
            }
            const params = new URLSearchParams(url.search);
            const keysToDelete = [];
            for (const key of params.keys()) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.startsWith('utm_') || lowerKey === 'fbclid' || lowerKey === 'gclid') {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(k => params.delete(k));
            const sortedParams = Array.from(params.entries()).sort((a, b) => {
                if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
                return a[1].localeCompare(b[1]);
            });
            const newSearch = new URLSearchParams(sortedParams).toString();
            url.search = newSearch ? `?${newSearch}` : '';
            return url.toString().toLowerCase().trim();
        } catch (e) {
            return urlStr.toLowerCase().trim();
        }
    };

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

            let data = null;
            try {
                data = await response.json();
            } catch (e) {}

            if (!response.ok) {
                let errMessage = "Failed to save content";
                if (data) {
                    errMessage = data.detail || data.error || errMessage;
                }
                throw new Error(errMessage);
            }

            const isDuplicate = response.headers.get("X-QueueIt-Duplicate") === "true" || (data && data.is_duplicate);

            // Success or Duplicate
            const successTextEl = successOverlay.querySelector('p');
            if (successTextEl) {
                successTextEl.textContent = isDuplicate ? "Already saved in Queue." : "Saved to Queue ✓";
            }
            successOverlay.classList.remove('hidden');

            if (isDuplicate && data && data.id) {
                chrome.tabs.create({ url: `http://localhost:3000/?item=${data.id}` });
            }

            setTimeout(() => {
                window.close();
            }, 1500);

        } catch (error) {
            showError(error.message);
        }
    });
});
