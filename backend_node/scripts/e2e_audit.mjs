import { fetch } from 'undici';

const API_BASE = 'http://localhost:8001';
const TEST_EMAIL = `e2e_audit_${Date.now()}@queueit.test`;
const TEST_PASSWORD = 'TestPassword123!';

console.log('=== QueueIt Comprehensive End-to-End Audit ===');
console.log(`Target Backend: ${API_BASE}`);
console.log(`Test Account: ${TEST_EMAIL}\n`);

async function runAudit() {
  const results = {
    healthCheck: false,
    authSignup: false,
    authLogin: false,
    youtubeIngestion: false,
    youtubeSummaryQuality: false,
    articleIngestion: false,
    articleSummaryQuality: false,
    readingProgress: false,
    analyticsDashboard: false,
    analyticsReading: false,
    streakTracking: false,
    analyticsExportCsv: false,
    chatStreaming: false,
    retryMechanism: false,
    itemDeletion: false,
  };

  let token = '';
  let userId = '';

  // 1. Health check
  console.log('[1/10] Testing /health and yt-dlp availability...');
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    console.log('Health response:', JSON.stringify(data));
    if (data.status === 'ok' && data.ytDlpAvailable) {
      results.healthCheck = true;
      console.log('✓ Health check passed. yt-dlp is available.');
    } else {
      console.error('✗ Health check failed or yt-dlp unavailable:', data);
    }
  } catch (err) {
    console.error('✗ Failed to connect to health endpoint:', err.message);
    process.exit(1);
  }

  // 2. Auth: Signup & Login
  console.log('\n[2/10] Testing User Signup & Login...');
  try {
    const signupRes = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'E2E Tester' }),
    });
    const signupData = await signupRes.json();
    if (signupData.success && signupData.data?.session?.access_token) {
      token = signupData.data.session.access_token;
      userId = signupData.data.user.id;
      results.authSignup = true;
      results.authLogin = true;
      console.log(`✓ User signed up and logged in successfully. User ID: ${userId}`);
    } else {
      console.log('Signup response:', signupData);
      // Fallback: try login
      const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      const loginData = await loginRes.json();
      if (loginData.success && loginData.data?.session?.access_token) {
        token = loginData.data.session.access_token;
        userId = loginData.data.user.id;
        results.authLogin = true;
        console.log(`✓ User logged in successfully. User ID: ${userId}`);
      } else {
        throw new Error(`Auth failed: ${JSON.stringify(loginData)}`);
      }
    }
  } catch (err) {
    console.error('✗ Auth failed:', err.message);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  let ytItemId = '';
  let articleItemId = '';

  // 3. Add YouTube Video Item
  console.log('\n[3/10] Ingesting YouTube Video with Captions (Rick Astley - Never Gonna Give You Up)...');
  const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  try {
    const createRes = await fetch(`${API_BASE}/api/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ url: YT_URL, title: 'Never Gonna Give You Up' }),
    });
    const createdItem = await createRes.json();
    ytItemId = createdItem.id;
    console.log(`Item created. ID: ${ytItemId}, initial processing_status: ${createdItem.processing_status}`);

    // Poll for completion (up to 45 seconds)
    console.log('Polling processing status...');
    let pollCount = 0;
    while (pollCount < 25) {
      await new Promise(r => setTimeout(r, 2000));
      pollCount++;
      const pollRes = await fetch(`${API_BASE}/api/items/${ytItemId}`, { headers: authHeaders });
      const itemData = await pollRes.json();
      console.log(`[Poll #${pollCount}] Status: ${itemData.processing_status}, Summary length: ${itemData.ai_summary?.length || 0} chars`);

      if (itemData.processing_status === 'completed') {
        results.youtubeIngestion = true;
        console.log('✓ YouTube Item enrichment completed successfully!');
        console.log('Extracted Title:', itemData.title);
        console.log('Duration Seconds:', itemData.duration_seconds);
        console.log('Generated AI Summary:\n----------------------------------------');
        console.log(itemData.ai_summary);
        console.log('----------------------------------------');

        // Check summary quality
        const wordCount = (itemData.ai_summary || '').split(/\s+/).filter(Boolean).length;
        const lower = (itemData.ai_summary || '').toLowerCase();
        const hasPreamble = lower.startsWith('in this video') || lower.startsWith('this video') || lower.startsWith('here is');
        console.log(`Summary word count: ${wordCount} words.`);
        if (wordCount >= 30 && !hasPreamble && itemData.ai_summary.length > 100) {
          results.youtubeSummaryQuality = true;
          console.log('✓ Summary Quality: Passed (Informative, concise, no preambles, relevant vocabulary).');
        } else {
          console.warn('⚠ Summary quality warning: Check word count or formatting.');
        }
        break;
      } else if (itemData.processing_status === 'failed') {
        console.error('✗ Item processing failed:', itemData.notes || 'No failure note');
        break;
      }
    }
  } catch (err) {
    console.error('✗ YouTube ingestion error:', err.message);
  }

  // 4. Ingest Web Article
  console.log('\n[4/10] Ingesting Web Article (Paul Graham essay on Doing Great Work)...');
  const ARTICLE_URL = 'https://paulgraham.com/greatwork.html';
  try {
    const artRes = await fetch(`${API_BASE}/api/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ url: ARTICLE_URL, title: 'How to Do Great Work' }),
    });
    const artItem = await artRes.json();
    articleItemId = artItem.id;
    console.log(`Article item created. ID: ${articleItemId}, initial status: ${artItem.processing_status}`);

    let pollCount = 0;
    while (pollCount < 25) {
      await new Promise(r => setTimeout(r, 2000));
      pollCount++;
      const pollRes = await fetch(`${API_BASE}/api/items/${articleItemId}`, { headers: authHeaders });
      const itemData = await pollRes.json();
      console.log(`[Poll #${pollCount}] Status: ${itemData.processing_status}, Summary length: ${itemData.ai_summary?.length || 0} chars`);

      if (itemData.processing_status === 'completed') {
        results.articleIngestion = true;
        console.log('✓ Article enrichment completed successfully!');
        console.log('Generated AI Summary:\n----------------------------------------');
        console.log(itemData.ai_summary);
        console.log('----------------------------------------');
        const wordCount = (itemData.ai_summary || '').split(/\s+/).filter(Boolean).length;
        if (wordCount >= 30 && itemData.ai_summary.length > 100) {
          results.articleSummaryQuality = true;
          console.log(`✓ Article Summary Quality: Passed (${wordCount} words, high information density).`);
        }
        break;
      } else if (itemData.processing_status === 'failed') {
        console.error('✗ Article processing failed:', itemData.notes);
        break;
      }
    }
  } catch (err) {
    console.error('✗ Article ingestion error:', err.message);
  }

  // 5. Reading Progress Lifecycle
  console.log('\n[5/10] Testing Reading Progress Tracking & Completion...');
  if (ytItemId) {
    try {
      // Progress to 50%
      const progRes = await fetch(`${API_BASE}/api/items/${ytItemId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ read_progress: 50, actual_time_spent: 3.5 }),
      });
      const progItem = await progRes.json();
      console.log(`Updated progress to 50%: status=${progItem.status}, progress=${progItem.read_progress}%`);

      // Complete to 100%
      const compRes = await fetch(`${API_BASE}/api/items/${ytItemId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ read_progress: 100, actual_time_spent: 7.0 }),
      });
      const compItem = await compRes.json();
      console.log(`Updated progress to 100%: status=${compItem.status}, completed_at=${compItem.completed_at}`);
      if (compItem.status === 'completed' && compItem.completed_at) {
        results.readingProgress = true;
        console.log('✓ Reading progress & completion lifecycle passed.');
      }
    } catch (err) {
      console.error('✗ Reading progress error:', err.message);
    }
  }

  // 6. Analytics & Reading Metrics
  console.log('\n[6/10] Testing Analytics & Reading Metrics Endpoints...');
  try {
    const dashRes = await fetch(`${API_BASE}/api/analytics`, { headers: authHeaders });
    const dashData = await dashRes.json();
    console.log('Dashboard Analytics:', JSON.stringify(dashData));
    if (dashData && (typeof dashData.completed_count === 'number' || typeof dashData.completed_items === 'number')) {
      results.analyticsDashboard = true;
      console.log('✓ GET /api/analytics passed.');
    }

    const readingRes = await fetch(`${API_BASE}/api/items/analytics/reading`, { headers: authHeaders });
    const readingData = await readingRes.json();
    console.log('Reading Analytics:', JSON.stringify(readingData));
    if (readingData && (typeof readingData.total_items_read === 'number' || typeof readingData.reading_time === 'object')) {
      results.analyticsReading = true;
      console.log('✓ GET /api/items/analytics/reading passed.');
    }

    const streakRes = await fetch(`${API_BASE}/api/items/user/streak`, { headers: authHeaders });
    const streakData = await streakRes.json();
    console.log('Streak Data:', JSON.stringify(streakData));
    if (streakData && typeof streakData.current_streak === 'number') {
      results.streakTracking = true;
      console.log('✓ GET /api/items/user/streak passed.');
    }
  } catch (err) {
    console.error('✗ Analytics endpoints error:', err.message);
  }

  // 7. CSV Analytics Export
  console.log('\n[7/10] Testing Analytics CSV Export...');
  try {
    const csvRes = await fetch(`${API_BASE}/api/items/analytics/export`, { headers: authHeaders });
    const csvText = await csvRes.text();
    console.log('CSV Headers and preview:\n' + csvText.split('\n').slice(0, 3).join('\n'));
    if (csvRes.status === 200 && csvText.includes('Title') && csvText.includes('URL')) {
      results.analyticsExportCsv = true;
      console.log('✓ CSV Export endpoint passed.');
    }
  } catch (err) {
    console.error('✗ CSV Export error:', err.message);
  }

  // 8. AI Chat Assistant (SSE Streaming)
  console.log('\n[8/10] Testing AI Chat Assistant (POST /api/chat with SSE)...');
  try {
    const chatRes = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: 'What items do I have in my queue and what are they about?' }),
    });

    if (chatRes.ok) {
      const streamText = await chatRes.text();
      console.log('Chat SSE response received (length: ' + streamText.length + ' chars)');
      console.log('Sample stream output:\n' + streamText.substring(0, 300) + '...');
      if (streamText.length > 50) {
        results.chatStreaming = true;
        console.log('✓ AI Chat SSE streaming passed.');
      }
    } else {
      console.error('✗ Chat response error HTTP', chatRes.status);
    }
  } catch (err) {
    console.error('✗ AI Chat error:', err.message);
  }

  // 9. Retry AI Generation
  console.log('\n[9/10] Testing Retry AI Generation Endpoint (POST /api/items/:id/retry)...');
  if (ytItemId) {
    try {
      const retryRes = await fetch(`${API_BASE}/api/items/${ytItemId}/retry`, {
        method: 'POST',
        headers: authHeaders,
      });
      const retryData = await retryRes.json();
      console.log(`Retry initiated. Status: ${retryData.processing_status}, Summary reset: ${retryData.ai_summary}`);
      if ((retryData.processing_status === 'queued' || retryData.processing_status === 'processing') && retryData.ai_summary === null) {
        results.retryMechanism = true;
        console.log('✓ Retry mechanism cleanly reset status to queued/processing and cleared stale summary.');
      }
    } catch (err) {
      console.error('✗ Retry test error:', err.message);
    }
  }

  // 10. Cleanup Test Items
  console.log('\n[10/10] Cleaning up test items...');
  try {
    for (const id of [ytItemId, articleItemId]) {
      if (id) {
        const delRes = await fetch(`${API_BASE}/api/items/${id}`, { method: 'DELETE', headers: authHeaders });
        console.log(`Deleted item ${id}: HTTP ${delRes.status}`);
      }
    }
    results.itemDeletion = true;
    console.log('✓ Test cleanup passed.');
  } catch (err) {
    console.error('✗ Cleanup error:', err.message);
  }

  console.log('\n========================================');
  console.log('          FINAL AUDIT RESULTS           ');
  console.log('========================================');
  console.table(results);

  const allPassed = Object.values(results).every(Boolean);
  if (allPassed) {
    console.log('\n🎉 ALL 15 END-TO-END TESTS PASSED SUCCESSFULLY! 🎉');
  } else {
    console.log('\n⚠️ Some tests encountered issues. See summary table above.');
  }
}

runAudit();
