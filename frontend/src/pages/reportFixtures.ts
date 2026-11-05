import type { Language } from '../theme';
import type { ReportData, Result } from './ReportView';

const summaryByLanguage = {
  en: 'Your haemoglobin is a little below the usual range.',
  te: 'మీ హీమోగ్లోబిన్ సాధారణ పరిధి కంటే కొద్దిగా తక్కువగా ఉంది.',
  hi: 'आपका हीमोग्लोबिन सामान्य सीमा से थोड़ा कम है।',
} satisfies Record<Language, string>;

const sampleReport: ReportData = {
  order: { id: 'LAB-20481', patient: 'Anita Rao', date: '5 November 2026' },
  language: 'en',
  results: [
    { id: 'hb', name: 'Haemoglobin', value: 10.2, displayValue: '10.2', unit: 'g/dL', low: 12, high: 15.5, displayRange: '12.0 to 15.5 g/dL', status: 'low', trend: [13.1, 12.4, 10.2], summaries: summaryByLanguage },
    { id: 'wbc', name: 'White blood cells', value: 7.1, displayValue: '7.1', unit: '10⁹/L', low: 4, high: 11, displayRange: '4.0 to 11.0 10⁹/L', status: 'normal', trend: [6.8, 7.4, 7.1], summaries: { en: 'This result is within the usual range.', te: 'ఈ ఫలితం సాధారణ పరిధిలో ఉంది.', hi: 'यह परिणाम सामान्य सीमा के भीतर है।' } },
    { id: 'plt', name: 'Platelets', value: 248, displayValue: '248', unit: '10⁹/L', low: 150, high: 400, displayRange: '150 to 400 10⁹/L', status: 'normal', trend: [242, 260, 248], summaries: { en: 'This result is within the usual range.', te: 'ఈ ఫలితం సాధారణ పరిధిలో ఉంది.', hi: 'यह परिणाम सामान्य सीमा के भीतर है।' } },
  ],
};

const longTeluguSummary = 'ఈ ఫలితం సాధారణ పరిధికి వెలుపల ఉంది. మీ పరీక్ష ఫలితాల గురించి సందేహాలు లేదా ప్రశ్నలు ఉంటే, దయచేసి నమూనా సేకరించిన ప్రయోగశాలను సంప్రదించండి. మా బృందం మీకు వివరంగా సహాయం చేస్తుంది.';

export const reportFixtures = {
  standard: sampleReport,
  normal: {
    ...sampleReport,
    results: sampleReport.results.map((result) => ({ ...result, status: 'normal' as const })),
  },
  high: {
    ...sampleReport,
    results: [{ ...sampleReport.results[0], id: 'hb-high', value: 17.1, displayValue: '17.1', status: 'high' as const }],
  },
  critical: {
    ...sampleReport,
    results: [{ ...sampleReport.results[0], id: 'hb-critical', status: 'critical' as const }],
  },
  missingSummary: {
    ...sampleReport,
    results: [{ ...sampleReport.results[0], id: 'hb-no-summary', summaries: undefined }],
  },
  longTelugu: {
    ...sampleReport,
    results: [{
      ...sampleReport.results[0],
      id: 'hb-long-te',
      summaries: {
        en: 'This result is outside the usual range. Contact the lab if you have questions.',
        te: longTeluguSummary,
        hi: 'यह परिणाम सामान्य सीमा से बाहर है। यदि आपके कोई प्रश्न हों, तो प्रयोगशाला से संपर्क करें।',
      },
    }],
  },
} satisfies Record<string, ReportData>;

export type ReportFixtureName = keyof typeof reportFixtures;
