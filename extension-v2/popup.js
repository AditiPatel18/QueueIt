document.addEventListener('DOMContentLoaded', async () => {
    const previewTitleEl = document.getElementById('preview-title');
    const sourceNameEl = document.getElementById('source-name');
    const readTimeEl = document.getElementById('read-time');
    const faviconImgEl = document.getElementById('favicon-img');
    const statusBadge = document.getElementById('status-badge');
    const footerActions = document.getElementById('footer-actions');
    const actionBtn = document.getElementById('action-btn');

    // Toasts
    const toastLoading = document.getElementById('toast-loading');
    const toastSuccess = document.getElementById('toast-success');
    const toastDuplicate = document.getElementById('toast-duplicate');
    const toastError = document.getElementById('toast-error');
    const errorMessageEl = document.getElementById('error-message');

    let currentUrl = '';
    let currentTitle = '';
    let currentType = 'article';

    // Configuration constants
    const CONFIG = {
        PRODUCTION_WEB_URL: "https://queueit-one.vercel.app",
        LOCAL_WEB_URLS: ["http://localhost:3000", "http://127.0.0.1:3000"],
        PRODUCTION_API_URL: "https://queueit-one.vercel.app/api/items",
        LOCAL_API_URL: "http://localhost:8001/api/items",
    };

    const APP_URLS = [CONFIG.PRODUCTION_WEB_URL, ...CONFIG.LOCAL_WEB_URLS];

    // Helpers to show toasts
    const hideAllToasts = () => {
        toastLoading.classList.add('hidden');
        toastSuccess.classList.add('hidden');
        toastDuplicate.classList.add('hidden');
        toastError.classList.add('hidden');
    };

    const showToast = (toastEl) => {
        hideAllToasts();
        toastEl.classList.remove('hidden');
    };

    const showError = (msg, isLoginErr = false, targetWebUrl = CONFIG.PRODUCTION_WEB_URL) => {
        errorMessageEl.textContent = msg;
        showToast(toastError);
        footerActions.classList.remove('hidden');
        if (isLoginErr) {
            actionBtn.textContent = "Open QueueIt Login";
            actionBtn.onclick = () => {
                chrome.tabs.create({ url: `${targetWebUrl}/login` });
            };
        } else {
            actionBtn.textContent = "Open Dashboard";
            actionBtn.onclick = () => {
                chrome.tabs.create({ url: `${targetWebUrl}/dashboard` });
            };
        }
    };

    // Normalize URL for duplicate comparison
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

    // Detect Page Type
    const detectType = (url) => {
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
        if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter';
        if (lowerUrl.includes('github.com')) return 'github';
        if (lowerUrl.endsWith('.pdf') || lowerUrl.includes('.pdf')) return 'pdf';
        return 'article';
    };

    // Update Status Badge UI
    const updateBadgeUI = (type) => {
        statusBadge.textContent = type === 'twitter' ? 'X/Twitter' : type;
        statusBadge.className = 'badge';
        statusBadge.classList.add(`badge-${type}`);
    };

    // Helper: extract auth token from cookies array
    const extractTokenFromCookies = (cookies) => {
        if (!cookies || cookies.length === 0) return null;

        const authCookies = cookies.filter(
            c => c.name && (c.name.includes("-auth-token") || c.name.includes("access-token") || c.name.includes("sb-"))
        );

        if (authCookies.length === 0) return null;

        try {
            authCookies.sort((a, b) => {
                const aSuffix = a.name.split('.').pop();
                const bSuffix = b.name.split('.').pop();
                const aNum = isNaN(aSuffix) ? -1 : parseInt(aSuffix, 10);
                const bNum = isNaN(bSuffix) ? -1 : parseInt(bSuffix, 10);
                return aNum - bNum;
            });

            let value = authCookies.map(c => c.value).join('');
            if (value.startsWith("base64-")) {
                value = atob(value.substring(7));
            } else {
                try { value = decodeURIComponent(value); } catch (e) {}
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
            return token;
        } catch (err) {
            return null;
        }
    };

    // Fetch auth session from production or local cookies
    const getAuthSession = async (forceRefresh = false) => {
        return new Promise((resolve) => {
            if (!forceRefresh) {
                chrome.storage.local.get(['authToken', 'appUrl'], (result) => {
                    if (result && result.authToken) {
                        return resolve({ token: result.authToken, appUrl: result.appUrl || CONFIG.PRODUCTION_WEB_URL });
                    }
                    fetchFromCookies();
                });
            } else {
                fetchFromCookies();
            }

            function fetchFromCookies() {
                let urlIndex = 0;

                function tryNextUrl() {
                    if (urlIndex >= APP_URLS.length) {
                        console.error("Auth session cookie not found on any configured URL");
                        return resolve(null);
                    }

                    const targetUrl = APP_URLS[urlIndex++];
                    chrome.cookies.getAll({ url: targetUrl }, (cookies) => {
                        if (chrome.runtime.lastError || !cookies || cookies.length === 0) {
                            tryNextUrl();
                            return;
                        }

                        const token = extractTokenFromCookies(cookies);
                        if (token) {
                            chrome.storage.local.set({ authToken: token, appUrl: targetUrl }, () => {
                                resolve({ token, appUrl: targetUrl });
                            });
                            return;
                        }
                        tryNextUrl();
                    });
                }

                tryNextUrl();
            }
        });
    };

    // One-Click Save Flow
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
            showError("Cannot access current tab info.");
            return;
        }

        currentUrl = activeTab.url;
        currentTitle = activeTab.title || "Untitled Page";
        currentType = detectType(currentUrl);

        previewTitleEl.textContent = currentTitle;
        previewTitleEl.classList.remove('title-loading');
        updateBadgeUI(currentType);
        
        try {
            const domain = new URL(currentUrl).hostname.replace('www.', '');
            sourceNameEl.textContent = domain;
            faviconImgEl.src = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
        } catch (e) {
            sourceNameEl.textContent = "unknown";
        }
        readTimeEl.textContent = "~1 min read";

        // Check login credentials first
        const session = await getAuthSession();
        if (!session || !session.token) {
            showError("Please log in to QueueIt first", true, CONFIG.PRODUCTION_WEB_URL);
            return;
        }

        // Get detailed page info from content script
        chrome.tabs.sendMessage(activeTab.id, { action: "getPageInfo" }, async (response) => {
            let extractedTitle = currentTitle;
            let faviconUrl = faviconImgEl.src;
            let estReadTime = 1;

            if (!chrome.runtime.lastError && response) {
                if (response.title && response.title.trim() !== "YouTube") {
                    extractedTitle = response.title;
                }
                if (extractedTitle.includes(" - YouTube")) {
                    extractedTitle = extractedTitle.replace(" - YouTube", "").trim();
                }
                
                previewTitleEl.textContent = extractedTitle;
                if (response.siteName) {
                    sourceNameEl.textContent = response.siteName;
                }
                if (response.estimatedReadTime) {
                    estReadTime = response.estimatedReadTime;
                    readTimeEl.textContent = `~${estReadTime} min read`;
                }
                if (response.faviconUrl) {
                    faviconUrl = response.faviconUrl;
                    faviconImgEl.src = faviconUrl;
                }
            }

            // Perform Save Process
            await saveToQueue(currentUrl, extractedTitle);
        });
    });

    // Check duplicate and save to API
    async function saveToQueue(url, title, isRetry = false) {
        showToast(toastLoading);

        let session = await getAuthSession(isRetry);
        if (!session || !session.token) {
            showError("Please log in to QueueIt first", true, CONFIG.PRODUCTION_WEB_URL);
            return;
        }

        const token = session.token;
        const targetWebUrl = session.appUrl || CONFIG.PRODUCTION_WEB_URL;
        const isProdSession = targetWebUrl.startsWith("https://queueit-one.vercel.app");
        const primaryApiUrl = isProdSession ? CONFIG.PRODUCTION_API_URL : CONFIG.LOCAL_API_URL;
        const fallbackApiUrl = isProdSession ? CONFIG.LOCAL_API_URL : CONFIG.PRODUCTION_API_URL;

        try {
            // 1. Check for duplicates in recent queue items
            let getResponse;
            try {
                getResponse = await fetch(`${primaryApiUrl}?limit=100`, {
                    method: "GET",
                    headers: { "Authorization": `Bearer ${token}` }
                });
            } catch (err) {
                getResponse = await fetch(`${fallbackApiUrl}?limit=100`, {
                    method: "GET",
                    headers: { "Authorization": `Bearer ${token}` }
                });
            }

            if (getResponse.status === 401 || getResponse.status === 403) {
                chrome.storage.local.remove(['authToken', 'appUrl'], async () => {
                    if (!isRetry) {
                        await saveToQueue(url, title, true);
                    } else {
                        showError("Please log in to QueueIt first", true, targetWebUrl);
                    }
                });
                return;
            }

            if (getResponse.ok) {
                const data = await getResponse.json();
                const items = data.items || [];
                const normalizedCurrentUrl = normalizeUrl(url);

                const duplicateItem = items.find(item => normalizeUrl(item.url) === normalizedCurrentUrl);
                if (duplicateItem) {
                    showToast(toastDuplicate);
                    footerActions.classList.remove('hidden');
                    actionBtn.textContent = "Open Item";
                    actionBtn.onclick = () => {
                        chrome.tabs.create({ url: `${targetWebUrl}/dashboard?item=${duplicateItem.id}` });
                        window.close();
                    };
                    return;
                }
            }

            // 2. Save to QueueIt
            let saveResponse;
            let responseData = null;

            try {
                saveResponse = await fetch(primaryApiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ url: url, title: title || undefined })
                });
            } catch (netErr) {
                saveResponse = await fetch(fallbackApiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ url: url, title: title || undefined })
                });
            }

            if (saveResponse.status === 401 || saveResponse.status === 403) {
                chrome.storage.local.remove(['authToken', 'appUrl'], async () => {
                    if (!isRetry) {
                        await saveToQueue(url, title, true);
                    } else {
                        showError("Please log in to QueueIt first", true, targetWebUrl);
                    }
                });
                return;
            }

            try { responseData = await saveResponse.json(); } catch (e) {}

            if (!saveResponse.ok) {
                let errMsg = "Failed to save content";
                if (responseData) {
                    errMsg = responseData.detail || responseData.error || responseData.message || errMsg;
                }
                throw new Error(errMsg);
            }

            const isServerDuplicate = saveResponse.headers.get("X-QueueIt-Duplicate") === "true" || (responseData && responseData.is_duplicate);
            if (isServerDuplicate) {
                showToast(toastDuplicate);
                footerActions.classList.remove('hidden');
                actionBtn.textContent = "Open Item";
                actionBtn.onclick = () => {
                    if (responseData && responseData.id) {
                        chrome.tabs.create({ url: `${targetWebUrl}/dashboard?item=${responseData.id}` });
                    } else {
                        chrome.tabs.create({ url: `${targetWebUrl}/dashboard` });
                    }
                    window.close();
                };
                return;
            }

            // Successful save!
            showToast(toastSuccess);
            setTimeout(() => {
                window.close();
            }, 1500);

        } catch (error) {
            console.error("Save error:", error);
            showError(error.message || "Failed to save item", false, targetWebUrl);
        }
    }
});
