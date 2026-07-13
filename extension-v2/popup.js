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

    const showError = (msg, isLoginErr = false) => {
        errorMessageEl.textContent = msg;
        showToast(toastError);
        footerActions.classList.remove('hidden');
        if (isLoginErr) {
            actionBtn.textContent = "Open QueueIt";
        } else {
            actionBtn.textContent = "Open Dashboard";
        }
        actionBtn.onclick = () => {
            chrome.tabs.create({ url: 'http://localhost:3000/' });
        };
    };

    // Normalize URL for duplicate comparison
    const normalizeUrl = (urlStr) => {
        try {
            const url = new URL(urlStr);
            url.hash = '';
            // Remove trailing slash if path is longer than '/'
            if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
                url.pathname = url.pathname.slice(0, -1);
            }
            // Filter query parameters
            const params = new URLSearchParams(url.search);
            const keysToDelete = [];
            for (const key of params.keys()) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.startsWith('utm_') || lowerKey === 'fbclid' || lowerKey === 'gclid') {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(k => params.delete(k));
            
            // Sort query parameters
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
        statusBadge.className = 'badge'; // Reset classes
        statusBadge.classList.add(`badge-${type}`);
    };

    // Fetch auth token from localhost cookies
    const getAuthToken = async (forceRefresh = false) => {
        return new Promise((resolve) => {
            if (!forceRefresh) {
                chrome.storage.local.get(['authToken'], (result) => {
                    if (result && result.authToken) {
                        return resolve(result.authToken);
                    }
                    fetchFromCookies();
                });
            } else {
                fetchFromCookies();
            }

            function fetchFromCookies() {
                chrome.cookies.getAll({}, (cookies) => {
                    if (chrome.runtime.lastError || !cookies) {
                        console.error("Failed to get cookies:", chrome.runtime.lastError);
                        return resolve(null);
                    }

                    // Look for Supabase auth token cookie on localhost
                    const authCookie = cookies.find(
                        c => c.name && c.name.endsWith("-auth-token") && (c.domain.includes("localhost") || c.domain.includes("127.0.0.1"))
                    );

                    if (!authCookie) {
                        console.error("Auth token cookie not found");
                        return resolve(null);
                    }

                    try {
                        let value = authCookie.value;
                        if (value.startsWith("base64-")) {
                            value = atob(value.substring(7));
                        }
                        const parsed = JSON.parse(value);
                        if (parsed.access_token) {
                            chrome.storage.local.set({ authToken: parsed.access_token }, () => {
                                resolve(parsed.access_token);
                            });
                            return;
                        }
                        resolve(null);
                    } catch (err) {
                        console.error("Token parse error:", err);
                        resolve(null);
                    }
                });
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

        // Pre-populate with Tab info while content script loads
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
        const token = await getAuthToken();
        if (!token) {
            showError("Please login to QueueIt", true);
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

        let token = await getAuthToken(isRetry);
        if (!token) {
            showError("Please login to QueueIt", true);
            return;
        }

        try {
            // 1. Check for duplicates in recent queue items (limit 100)
            const getResponse = await fetch("http://localhost:8000/api/items?limit=100", {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });

            if (getResponse.status === 401 || getResponse.status === 403) {
                chrome.storage.local.remove(['authToken'], async () => {
                    if (!isRetry) {
                        console.log("Token expired/invalid (401/403). Retrying save with refreshed token...");
                        await saveToQueue(url, title, true);
                    } else {
                        showError("Please login to QueueIt", true);
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
                        chrome.tabs.create({ url: `http://localhost:3000/?item=${duplicateItem.id}` });
                        window.close();
                    };
                    return;
                }
            }

            // 2. Not duplicate, save to QueueIt
            const saveResponse = await fetch("http://localhost:8000/api/items", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    url: url,
                    title: title || undefined
                })
            });

            if (saveResponse.status === 401 || saveResponse.status === 403) {
                chrome.storage.local.remove(['authToken'], async () => {
                    if (!isRetry) {
                        console.log("Token expired/invalid (401/403). Retrying save with refreshed token...");
                        await saveToQueue(url, title, true);
                    } else {
                        showError("Please login to QueueIt", true);
                    }
                });
                return;
            }

            if (!saveResponse.ok) {
                let errMsg = "Failed to save content";
                try {
                    const errData = await saveResponse.json();
                    errMsg = errData.detail || errData.error || errMsg;
                } catch (e) {}
                throw new Error(errMsg);
            }

            const responseData = await saveResponse.json();
            
            const isServerDuplicate = saveResponse.headers.get("X-QueueIt-Duplicate") === "true" || responseData.is_duplicate;
            if (isServerDuplicate) {
                showToast(toastDuplicate);
                footerActions.classList.remove('hidden');
                actionBtn.textContent = "Open Item";
                actionBtn.onclick = () => {
                    chrome.tabs.create({ url: `http://localhost:3000/?item=${responseData.id}` });
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
            showError(error.message || "Failed to save item");
        }
    }
});
