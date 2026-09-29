async function getYouTubeTranscriptText() {
  if (!window.location.hostname.includes("youtube.com") && !window.location.hostname.includes("youtu.be")) {
    return "";
  }

  try {
    let tracks = null;

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || "";
      if (text.includes('"captionTracks":')) {
        const idx = text.indexOf('"captionTracks":');
        const startIdx = text.indexOf('[', idx);
        let depth = 0, endIdx = -1;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '[') depth++;
          else if (text[i] === ']') depth--;
          if (depth === 0) { endIdx = i + 1; break; }
        }
        if (endIdx !== -1) {
          try {
            const parsed = JSON.parse(text.substring(startIdx, endIdx));
            if (Array.isArray(parsed) && parsed.length > 0) {
              tracks = parsed;
              break;
            }
          } catch (e) {}
        }
      }
    }

    if (!tracks || !tracks.length) {
      const html = document.documentElement.innerHTML || "";
      const idx = html.indexOf('"captionTracks":');
      if (idx !== -1) {
        const startIdx = html.indexOf('[', idx);
        let depth = 0, endIdx = -1;
        for (let i = startIdx; i < html.length; i++) {
          if (html[i] === '[') depth++;
          else if (html[i] === ']') depth--;
          if (depth === 0) { endIdx = i + 1; break; }
        }
        if (endIdx !== -1) {
          try {
            const parsed = JSON.parse(html.substring(startIdx, endIdx));
            if (Array.isArray(parsed) && parsed.length > 0) {
              tracks = parsed;
            }
          } catch (e) {}
        }
      }
    }

    if (!Array.isArray(tracks) || tracks.length === 0) return "";

    const preferredTrack = tracks.find(t =>
      t.languageCode === 'en' ||
      t.vssId?.includes('en') ||
      t.vssId?.includes('.en') ||
      t.name?.runs?.[0]?.text?.toLowerCase().includes('english')
    ) || tracks[0];

    if (!preferredTrack || !preferredTrack.baseUrl) return "";

    let bUrl = preferredTrack.baseUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    if (bUrl.startsWith('/')) {
      bUrl = window.location.origin + bUrl;
    }

    const res = await fetch(bUrl);
    if (!res.ok) return "";
    const raw = await res.text();

    if (raw.trim().startsWith('{')) {
      try {
        const jsonCap = JSON.parse(raw);
        const parts = [];
        if (Array.isArray(jsonCap.events)) {
          for (const ev of jsonCap.events) {
            if (Array.isArray(ev.segs)) {
              for (const seg of ev.segs) {
                if (seg.utf8) parts.push(seg.utf8);
              }
            }
          }
        }
        const parsed = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (parsed.length > 20) return parsed;
      } catch (e) {}
    }

    return raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (e) {
    return "";
  }
}

// Listen for requests from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    (async () => {
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
      const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      const transcriptText = await getYouTubeTranscriptText();

      sendResponse({
        title: title || "",
        url: window.location.href,
        siteName: siteName || "",
        estimatedReadTime: readTimeMinutes,
        transcriptText: transcriptText || ""
      });
    })();
    return true;
  }
  return true;
});

