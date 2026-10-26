/**
 * PDF text extraction in the browser with pdf.js (loaded on demand, worker
 * served from this site — no CDN). Reconstructs lines by the y-coordinate of
 * text items so table rows stay on one line.
 */
export class PdfError extends Error {}

export async function extractPdfText(buf: ArrayBuffer, maxPages = 50): Promise<{ text: string; pages: number; truncated: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, verbosity: pdfjs.VerbosityLevel.ERRORS });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new PdfError('PDF защищён паролем. Снимите защиту и загрузите файл снова.');
    if (name === 'InvalidPDFException') throw new PdfError('Файл повреждён или не является PDF.');
    throw new PdfError('Не удалось открыть PDF.');
  }
  const pages = doc.numPages;
  const take = Math.min(pages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= take; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      const row = rows.get(y) ?? [];
      row.push({ x, s: item.str });
      rows.set(y, row);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((t) => t.s)
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      );
    out.push(lines.join('\n'));
    page.cleanup();
  }
  await task.destroy();
  return { text: out.join('\n\n'), pages, truncated: pages > maxPages };
}
