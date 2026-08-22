import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const workDir = await mkdtemp(join(tmpdir(), 'report-baby-editorial-'));
const outputPath = join(workDir, 'editorial.pdf');
const sentenceBank = [
  'Transport obserwuje zmiane popytu i porzadkuje dane z kolejnych tygodni.',
  'Analiza laczy wyniki operacyjne z informacjami o zachowaniu odbiorcow.',
  'Wnioski sa opisane w sposob, ktory pozwala porownac regiony i kanaly.',
  'Zespol sprawdza odchylenia, zanim podejmie decyzje dotyczace dalszych dzialan.',
  'Kazdy akapit dodaje kontekst i wskazuje, jak czytac przedstawione liczby.',
  'Raport pokazuje, ze konsolidacja wynikow wymaga ostroznej interpretacji.',
];
const firstBody = Array.from({ length: 150 }, (_, index) => sentenceBank[index % sentenceBank.length]).join(' ')
  + ' WNIOSKI_END';
const secondBody = 'RYNEK_START Dane z ostatniego okresu potwierdzaja stabilny kierunek i wymagaja dalszej obserwacji.';

try {
  const input = {
    template: 'pages/editorial-two-column',
    output_path: outputPath,
    data: {
      title: 'Editorial flow',
      sections: [
        { heading: 'Wnioski', body: firstBody },
        { heading: 'Rynek', body: secondBody },
      ],
    },
  };
  await execFileAsync(process.execPath, ['cli-bundle.cjs', 'render_report', JSON.stringify(input)], {
    cwd: root,
    env: { ...process.env, REPORT_BABY_DATA: workDir },
    maxBuffer: 1024 * 1024,
  });
  const { stdout } = await execFileAsync('pdftotext', [outputPath, '-']);
  const { stdout: bbox } = await execFileAsync('pdftotext', ['-bbox-layout', outputPath, '-']);
  const pages = [...bbox.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/g)].map((match) => match[1]);
  const firstPageWords = [...pages[0].matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)"[^>]*>([^<]+)<\/word>/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), text: match[3] }));
  const transport = firstPageWords.find((word) => word.text === 'Transport');
  assert.ok(transport, 'the first body line must contain Transport');
  assert.ok(firstPageWords.some((word) => word.text === 'obserwuje' && Math.abs(word.y - transport.y) < 0.01 && word.x < 300), 'the first body line must not leave Transport orphaned');
  assert.doesNotMatch(stdout, /konso-\s*lidacja/, 'ordinary prose must not be hyphenated before the line is full');
  const continuationWords = pages.slice(1).flatMap((page) => [...page.matchAll(/<word[^>]*yMin="([0-9.]+)"[^>]*>(Transport|obserwuje)<\/word>/g)]);
  assert.ok(continuationWords.length > 0, 'continuation pages must contain body text');
  assert.ok(continuationWords.every((match) => Number(match[1]) >= 275), 'dynamic flow must not resume inside the repeated header band');
  const compact = stdout.replace(/[\s-]+/g, '');
  const end = compact.indexOf('WNIOSKI_END');
  const heading = compact.indexOf('Rynek');
  assert.notEqual(end, -1, 'the first section end marker must be extractable');
  assert.notEqual(heading, -1, 'the second section heading must be extractable');
  assert.ok(end < heading, 'the first section must finish before the next heading');
  assert.match(compact, /RYNEK_START/);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log('Editorial dynamic flow: section order OK');
