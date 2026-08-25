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
 * Validates a URL to prevent SSRF and malicious protocol schemes.
 */
export function isSafeUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    let fullUrl = trimmed;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = 'https://' + fullUrl;
    }
    parsed = new URL(fullUrl);
  } catch {
    return false;
  }

  // Protocol check: only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject local/internal hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    return false;
  }

  // Reject IPv4 loopback, private, link-local, broadcast addresses
  // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);
  if (match) {
    const [, a, b] = match.map(n => parseInt(n, 10));
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }

  // Reject IPv6 loopback / unspecified
  if (hostname === '::1' || hostname === '[::1]' || hostname === '0:0:0:0:0:0:0:1') {
    return false;
  }

  return true;
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
