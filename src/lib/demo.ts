/** Loads a bundled demo file (same origin, no external network) as a File. */
export async function fetchDemoFile(name: string, mime = 'text/csv'): Promise<File> {
  const res = await fetch(`/demo/${name}`);
  if (!res.ok) throw new Error(`Не удалось загрузить демо-файл (${res.status})`);
  const blob = await res.blob();
  return new File([blob], name, { type: mime });
}
