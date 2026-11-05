import { useState } from 'react';
import { Select, ThemeSwitcher } from '../components/UI';
import { useTheme } from '../theme';
import { reportFixtures, type ReportFixtureName } from './reportFixtures';
import { ReportView, type ReportLayout } from './ReportView';

const fixtures: [ReportFixtureName, string][] = [
  ['standard', 'Normal and below range'],
  ['normal', 'All normal'],
  ['high', 'Above range'],
  ['critical', 'Critical'],
  ['missingSummary', 'Missing summary'],
  ['longTelugu', 'Long Telugu summary'],
];

export default function ReportStyleguide() {
  const [layout, setLayout] = useState<ReportLayout>('focus');
  const [fixture, setFixture] = useState<ReportFixtureName>('standard');
  const { theme, setTheme } = useTheme();
  return <div className="report-preview">
    <header className="styleguide-header"><a className="brand" href="/styleguide">← Style guide</a><ThemeSwitcher theme={theme} onChange={(value) => setTheme(value)} /></header>
    <nav className="layout-tabs" aria-label="Report layout">
      {(['focus', 'large', 'compact'] as const).map((value) => <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </nav>
    <div className="fixture-picker"><Select label="Report fixture" value={fixture} onChange={(event) => {
      const selected = fixtures.find(([name]) => name === event.target.value);
      if (selected) setFixture(selected[0]);
    }}>
      {fixtures.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select></div>
    <ReportView layout={layout} report={reportFixtures[fixture]} />
  </div>;
}
