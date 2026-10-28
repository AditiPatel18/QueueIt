import dotenv from 'dotenv';
dotenv.config();
import { YouTubeExtractor } from '../src/services/youtubeExtractor';
import { AIService, prepareContentForSummarization, validateSummary } from '../src/services/aiService';

const videos = [
  { id: '1', name: 'Docker in 100 Seconds (DevOps)', url: 'https://www.youtube.com/watch?v=Gjnup-PuquQ' },
  { id: '2', name: 'Essence of Calculus (Mathematics)', url: 'https://www.youtube.com/watch?v=WUvTyaaNkzM' },
  { id: '3', name: 'What is a Neural Network? (Deep Learning)', url: 'https://www.youtube.com/watch?v=aircAruvnKk' }
];

async function main() {
  console.log('=== QueueIt YouTube Extraction & Quality Verification for 3 Videos ===\n');
  const report: any[] = [];

  for (const v of videos) {
    console.log('----------------------------------------------------------------');
    console.log(`Processing Video: ${v.name}`);
    console.log(`URL: ${v.url}`);

    const tMeta0 = Date.now();
    const ext = await YouTubeExtractor.extractYouTubeContent(v.url);
    const extDur = Date.now() - tMeta0;

    console.log(`Extraction completed in ${extDur}ms:`);
    console.log(`  Success: ${ext.success}`);
    console.log(`  Title: "${ext.title}"`);
    console.log(`  Duration: ${ext.durationSeconds}s`);
    console.log(`  Transcript Length: ${ext.transcriptLength} characters`);

    if (!ext.success || !ext.transcript) {
      console.error(`  Extraction Failed: ${ext.error}`);
      report.push({ name: v.name, url: v.url, success: false, error: ext.error });
      continue;
    }

    const tPrep0 = Date.now();
    const prep = prepareContentForSummarization(ext.transcript, 12000);
    const prepDur = Date.now() - tPrep0;
    console.log(`Transcript prepared in ${prepDur}ms (length: ${prep.length} chars)`);

    const tSum0 = Date.now();
    const sumResult = await AIService.generateSummary(ext.title || v.name, v.url, 'video', prep);
    const sumDur = Date.now() - tSum0;

    const summary = sumResult.summary;
    const wordCount = summary.split(/\s+/).filter(Boolean).length;
    const val = validateSummary(summary, prep);

    console.log(`Summary generated in ${sumDur}ms:`);
    console.log(`  Word count: ${wordCount} words`);
    console.log(`  Validation: ${val.valid ? 'VALID' : 'INVALID: ' + val.reason}`);
    console.log('Generated AI Summary:');
    console.log('----------------------------------------------------------------');
    console.log(summary);
    console.log('----------------------------------------------------------------\n');

    report.push({
      name: v.name,
      url: v.url,
      title: ext.title,
      durationSeconds: ext.durationSeconds,
      transcriptChars: ext.transcriptLength,
      extDurMs: extDur,
      sumDurMs: sumDur,
      totalDurMs: extDur + sumDur,
      wordCount,
      isValid: val.valid,
      summary,
    });
  }

  console.log('=== SUMMARY BENCHMARK TABLE ===');
  console.table(report.map(r => ({
    Video: r.name,
    Title: r.title?.substring(0, 30),
    DurationSec: r.durationSeconds,
    TranscriptChars: r.transcriptChars,
    ExtMs: r.extDurMs,
    SumMs: r.sumDurMs,
    TotalMs: r.totalDurMs,
    Words: r.wordCount,
    Valid: r.isValid,
  })));
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
