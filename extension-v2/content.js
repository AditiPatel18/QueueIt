// Listen for requests from the popup in Manifest V2
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    
    // Get title with special handling for YouTube SPA navigation
    let title = "";
    if (window.location.hostname.includes("youtube.com") || window.location.hostname.includes("youtu.be")) {
      const ytTitleEl = document.querySelector("h1.ytd-watch-metadata, #container h1.title, h1.ytd-video-primary-info-renderer");
      if (ytTitleEl && ytTitleEl.innerText.trim()) {
        title = ytTitleEl.innerText.trim();
      } else {
        title = document.title;
      }
    } else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      title = (ogTitle && ogTitle.getAttribute("content")) ? ogTitle.getAttribute("content") : document.title;
    }
    
    // Try to find og:site_name
    const ogSiteName = document.querySelector('meta[property="og:site_name"]');
    const siteName = ogSiteName ? ogSiteName.getAttribute("content") : window.location.hostname.replace('www.', '');

    // Get description for read time estimation
    const paragraphs = document.querySelectorAll('p');
    let textContent = '';
    paragraphs.forEach(p => { textContent += p.innerText + ' '; });
    
    const wordCount = textContent.trim().split(/\s+/).length;
    // Average reading speed is ~200-250 words per minute
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    // Resolve absolute favicon URL
    let faviconUrl = "";
    const iconEl = document.querySelector('link[rel*="icon"]');
    if (iconEl && iconEl.href) {
      faviconUrl = iconEl.href;
    } else {
      faviconUrl = window.location.origin + "/favicon.ico";
    }

    sendResponse({
      title: title || "",
      url: window.location.href,
      siteName: siteName || "",
      estimatedReadTime: readTimeMinutes,
      faviconUrl: faviconUrl
    });
  }
  return true;
});
