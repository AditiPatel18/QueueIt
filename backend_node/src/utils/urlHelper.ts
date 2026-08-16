/**
 * Normalizes a URL for duplicate detection.
 * Strips protocol, trailing slashes, query params tracking tokens, etc.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    let url = rawUrl.trim();
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const parsed = new URL(url);
    // Remove tracking params
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'si', 'feature', 'app', 'ved', 'usp',
    ];
    trackingParams.forEach(p => parsed.searchParams.delete(p));

    // Normalize host and pathname
    let normalized = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
    if (parsed.search) normalized += parsed.search;
    if (parsed.hash) normalized += parsed.hash;
    return normalized.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/**
 * Detect source type from URL.
 */
export function detectSourceType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/')) return 'youtube';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('reddit.com')) return 'reddit';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.endsWith('.pdf') || lower.includes('/pdf/')) return 'pdf';
  if (lower.includes('leetcode.com')) return 'article';
  return 'article';
}

/**
 * Resolve platform branding info from URL.
 */
export function resolvePlatformInfo(url: string): {
  source_type: string;
  source_name: string;
  source_domain: string;
  logo_url: string | null;
} {
  const lower = url.toLowerCase();
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');

    if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
      return { source_type: 'youtube', source_name: 'YouTube', source_domain: 'youtube.com', logo_url: 'https://www.youtube.com/favicon.ico' };
    }
    if (lower.includes('github.com')) {
      return { source_type: 'github', source_name: 'GitHub', source_domain: 'github.com', logo_url: 'https://github.com/favicon.ico' };
    }
    if (lower.includes('reddit.com')) {
      return { source_type: 'reddit', source_name: 'Reddit', source_domain: 'reddit.com', logo_url: 'https://www.reddit.com/favicon.ico' };
    }
    if (lower.includes('twitter.com') || lower.includes('x.com')) {
      return { source_type: 'twitter', source_name: 'X (Twitter)', source_domain: 'x.com', logo_url: 'https://x.com/favicon.ico' };
    }
    if (lower.includes('instagram.com')) {
      return { source_type: 'instagram', source_name: 'Instagram', source_domain: 'instagram.com', logo_url: 'https://www.instagram.com/favicon.ico' };
    }
    if (lower.endsWith('.pdf') || lower.includes('/pdf/')) {
      return { source_type: 'pdf', source_name: 'PDF Document', source_domain: domain, logo_url: null };
    }
    return { source_type: 'article', source_name: domain, source_domain: domain, logo_url: `https://${domain}/favicon.ico` };
  } catch {
    return { source_type: 'article', source_name: url, source_domain: url, logo_url: null };
  }
}
