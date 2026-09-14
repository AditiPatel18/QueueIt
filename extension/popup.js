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
    const loginLinkBtn = document.getElementById('login-link-btn');
    if (loginLinkBtn) {
        loginLinkBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: "https://queueit-one.vercel.app/login" });
        });
    }

    const showError = (msg, showLoginBtn = false) => {
        errorMessage.textContent = msg;
        errorContainer.classList.remove('hidden');
        saveBtn.disabled = false;
        btnText.textContent = "Try Again";
        if (loginLinkBtn) {
            if (showLoginBtn || msg.toLowerCase().includes("log in")) {
                loginLinkBtn.classList.remove('hidden');
            } else {
                loginLinkBtn.classList.add('hidden');
            }
        }
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

    // Configuration constants
    const CONFIG = {
        PRODUCTION_WEB_URL: "https://queueit-one.vercel.app",
        LOCAL_WEB_URLS: ["http://localhost:3000", "http://127.0.0.1:3000"],
        PRODUCTION_API_URL: "https://queueit-one.vercel.app/api/items",
        LOCAL_API_URL: "http://localhost:8001/api/items",
    };

    const APP_URLS = [CONFIG.PRODUCTION_WEB_URL, ...CONFIG.LOCAL_WEB_URLS];

    // Make error container clickable for quick login
    errorContainer.style.cursor = 'pointer';
    errorContainer.addEventListener('click', () => {
        if (errorMessage.textContent.includes("log in")) {
            chrome.tabs.create({ url: `${CONFIG.PRODUCTION_WEB_URL}/login` });
        }
    });

    // Helper: extract auth token from cookies array
    const extractTokenFromCookies = (cookies) => {
        if (!cookies || cookies.length === 0) return null;

        const cookieGroups = {};
        for (const c of cookies) {
            if (!c.name) continue;
            const baseName = c.name.replace(/\.\d+$/, '');
            if (!cookieGroups[baseName]) cookieGroups[baseName] = [];
            cookieGroups[baseName].push(c);
        }

        const groupNames = Object.keys(cookieGroups).sort((a, b) => {
            const aScore = a.includes("auth-token") ? 3 : a.includes("access-token") ? 2 : a.includes("sb-") ? 1 : 0;
            const bScore = b.includes("auth-token") ? 3 : b.includes("access-token") ? 2 : b.includes("sb-") ? 1 : 0;
            return bScore - aScore;
        });

        for (const baseName of groupNames) {
            const group = cookieGroups[baseName];
            group.sort((a, b) => {
                const aSuffix = a.name.split('.').pop();
                const bSuffix = b.name.split('.').pop();
                const aNum = isNaN(aSuffix) ? 0 : parseInt(aSuffix, 10);
                const bNum = isNaN(bSuffix) ? 0 : parseInt(bSuffix, 10);
                return aNum - bNum;
            });

            let value = group.map(c => c.value).join('');
            if (value.startsWith("base64-")) {
                try {
                    value = atob(value.substring(7));
                } catch (e) { /* non-fatal */ }
            } else {
                try {
                    value = decodeURIComponent(value);
                } catch (e) { /* non-fatal */ }
            }

            let token = null;
            if (value.startsWith("eyJ")) {
                token = value;
            } else {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "string") {
                        token = parsed[0];
                    } else if (parsed && parsed.access_token) {
                        token = parsed.access_token;
                    }
                } catch {
                    if (value.includes("eyJ")) {
                        const match = value.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+/);
                        if (match) token = match[0];
                    }
                }
            }

            if (token) return token;
        }

        return null;
    };

    // 2. Fetch auth session from production or local cookies
    const getAuthSession = async () => {
        return new Promise((resolve) => {
            let urlIndex = 0;

            function fetchFromCookies() {
                if (urlIndex >= APP_URLS.length) {
                    console.error("Auth session cookie not found on any configured URL");
                    return resolve(null);
                }

                const targetUrl = APP_URLS[urlIndex++];
                chrome.cookies.getAll({ url: targetUrl }, (cookies) => {
                    if (chrome.runtime.lastError || !cookies || cookies.length === 0) {
                        fetchFromCookies();
                        return;
                    }

                    const token = extractTokenFromCookies(cookies);
                    if (token) {
                        console.log("Access token extracted successfully from " + targetUrl);
                        return resolve({ token, appUrl: targetUrl });
                    }

                    fetchFromCookies();
                });
            }

            fetchFromCookies();
        });
    };

    // 3. Handle save
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        btnText.textContent = "Saving...";
        errorContainer.classList.add('hidden');

        try {
            const session = await getAuthSession();
            if (!session || !session.token) {
                showError("Please log in to QueueIt first", true);
                return;
            }

            const token = session.token;
            const isProdSession = session.appUrl.startsWith("https://queueit-one.vercel.app");
            const primaryApiUrl = isProdSession ? CONFIG.PRODUCTION_API_URL : CONFIG.LOCAL_API_URL;
            const fallbackApiUrl = isProdSession ? CONFIG.LOCAL_API_URL : CONFIG.PRODUCTION_API_URL;

            let response;
            let data = null;

            try {
                response = await fetch(primaryApiUrl, {
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
            } catch (netErr) {
                console.warn(`Primary API endpoint (${primaryApiUrl}) failed, attempting fallback (${fallbackApiUrl})...`, netErr);
                response = await fetch(fallbackApiUrl, {
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
            }

            try {
                data = await response.json();
            } catch (e) {}

            console.log(`[QueueIt Save] HTTP ${response.status}`, data ? { status: response.status, detail: data.detail || data.error } : "No JSON body");

            if (!response.ok) {
                let errMessage = `Server error (${response.status})`;
                if (data) {
                    errMessage = data.detail || data.error || data.message || errMessage;
                }
                const isAuthErr = response.status === 401 || errMessage.toLowerCase().includes("log in") || errMessage.toLowerCase().includes("unauthorized");
                showError(isAuthErr ? "Please log in to QueueIt first" : errMessage, isAuthErr);
                return;
            }

            const isDuplicate = response.headers.get("X-QueueIt-Duplicate") === "true" || (data && data.is_duplicate);

            // Success or Duplicate
            const successTextEl = successOverlay.querySelector('p');
            if (successTextEl) {
                successTextEl.textContent = isDuplicate ? "Already saved in Queue." : "Saved to Queue ✓";
            }
            successOverlay.classList.remove('hidden');

            setTimeout(() => {
                window.close();
            }, 1500);

        } catch (error) {
            showError(error.message);
        }
    });
});

