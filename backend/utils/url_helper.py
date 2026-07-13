import urllib.parse

def normalize_url(url_str: str) -> str:
    """
    Normalizes a URL by:
    1. Parsing the URL components.
    2. Lowercasing the scheme and netloc (domain).
    3. Stripping the fragment.
    4. Stripping trailing slashes from the path.
    5. Stripping tracking parameters (utm_*, fbclid, gclid).
    6. Sorting and deduplicating query parameters.
    """
    if not url_str:
        return ""
    
    url_str = url_str.strip()
    
    try:
        parsed = urllib.parse.urlparse(url_str)
        
        # Scheme & Netloc (domain) to lowercase
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()
        
        # Clean path: remove trailing slash if path is longer than '/'
        path = parsed.path
        if len(path) > 1 and path.endswith('/'):
            path = path.rstrip('/')
            
        # Parse and filter query parameters
        query_params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        filtered_params = []
        seen = set()
        
        for key, value in query_params:
            key_lower = key.lower()
            # Skip tracking parameters
            if key_lower.startswith('utm_') or key_lower in ('fbclid', 'gclid'):
                continue
            
            pair = (key, value)
            if pair not in seen:
                seen.add(pair)
                filtered_params.append(pair)
                
        # Sort parameters to ensure consistent query string ordering
        filtered_params.sort(key=lambda x: (x[0], x[1]))
        
        # Rebuild query string
        new_query = urllib.parse.urlencode(filtered_params)
        
        # Reconstruct normalized URL (fragment is empty)
        normalized = urllib.parse.urlunparse((
            scheme,
            netloc,
            path,
            parsed.params,
            new_query,
            ""
        ))
        
        return normalized
    except Exception as e:
        # Fallback to simple cleanup on parse error
        return url_str.lower().strip()
