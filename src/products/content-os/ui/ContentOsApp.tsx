import { useState } from 'react';
import { AppFrame, StartPanel, StorageStatus } from '../../../components/app/AppFrame';
import { FileDrop } from '../../../components/ui/FileDrop';
import { Spinner } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Tabs } from '../../../components/ui/Tabs';
import { UploadButton } from '../../../components/ui/UploadButton';
import { useToast } from '../../../components/ui/Toast';
import { useIdbState } from '../../../hooks/useIdbState';
import { downloadFile, safeFilename, stamp } from '../../../lib/download';
import { decodeText, readFileBuffer, validateFile } from '../../../lib/files';
import { uid } from '../../../lib/id';
import { clearProductData } from '../../../lib/storage';
import { analyze, validateSource } from '../logic/analyze';
import { demoProject } from '../logic/demo';
import { buildItems, projectToMarkdown } from '../logic/generate';
import { parseProjectsJson } from '../logic/io';
import type { ContentItem, Project } from '../logic/types';
import { CalendarTab } from './CalendarTab';
import { MaterialsTab } from './MaterialsTab';
import { ProjectTab } from './ProjectTab';
import './content-os.css';

interface CoState {
  projects: Project[];
  activeId: string | null;
}
const INITIAL: CoState = { projects: [], activeId: null };
type TabKey = 'project' | 'materials' | 'calendar';

const today = () => new Date().toISOString().slice(0, 10);

function emptyProject(n: number): Project {
  const now = Date.now();
  return { id: uid('p'), name: `Проект ${n}`, topic: '', audience: '', tone: 'friendly', platforms: ['telegram', 'vk', 'email'], source: '', startDate: today(), createdAt: now, updatedAt: now, analysis: null, items: [], variant: 0 };
}

export default function ContentOsApp() {
  const toast = useToast();
  const store = useIdbState<CoState>('content-os:state', INITIAL);
  const { value: state, setValue: setState, loaded } = store;
  const [tab, setTab] = useState<TabKey>('project');
  const [focus, setFocus] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const project = state.projects.find((p) => p.id === state.activeId) ?? state.projects[0] ?? null;

  const patchProject = (id: string, fn: (p: Project) => Project) =>
    setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p)) }));

  const build = (p: Project, opts: { overwrite?: boolean; variant?: number } = {}) => {
    const err = validateSource(p.source);
    if (err) {
      toast.error(err);
      return;
    }
    const next = { ...p, variant: opts.variant ?? p.variant };
    const analysis = analyze(next.source, next);
    const items = buildItems(next, analysis, opts.overwrite);
    patchProject(p.id, () => ({ ...next, analysis, items }));
    const kept = items.filter((i) => i.edited).length;
    toast.success(`Собрано материалов: ${items.length}${kept ? `, сохранены ручные правки в ${kept}` : ''}`, kept ? { action: { label: 'Перезаписать', onClick: () => build(next, { ...opts, overwrite: true }) } } : undefined);
    setTab('materials');
  };

  const updateItem = (id: string, patch: Partial<ContentItem>, versionLabel?: string) => {
    if (!project) return;
    patchProject(project.id, (p) => ({
      ...p,
      items: p.items.map((i) => (i.id === id ? { ...i, ...patch, versions: versionLabel ? [...i.versions, { at: Date.now(), title: i.title, body: i.body, label: versionLabel }].slice(-20) : i.versions } : i)),
    }));
  };

  const startDemo = () => {
    const p = demoProject(today());
    const analysis = analyze(p.source, p);
    const ready = { ...p, analysis, items: buildItems(p, analysis) };
    setState((s) => ({ projects: [ready, ...s.projects.filter((x) => !x.name.startsWith('Демо:'))], activeId: ready.id }));
    setTab('materials');
    toast.success(`Демо-проект: ${ready.items.length} материалов из одного текста`);
  };

  const newProject = (source = '', name?: string) => {
    const p = { ...emptyProject(state.projects.length + 1), source, ...(name ? { name } : {}) };
    setState((s) => ({ projects: [p, ...s.projects], activeId: p.id }));
    setTab('project');
  };

  const openSourceFile = async (file: File) => {
    setBusy(true);
    try {
      const ext = validateFile(file, { extensions: ['txt', 'md', 'markdown', 'json'], maxBytes: 2 * 1024 * 1024 });
      const { text } = decodeText(await readFileBuffer(file));
      if (ext === 'json') {
        const imported = parseProjectsJson(text).map((p) => ({ ...p, analysis: validateSource(p.source) ? null : analyze(p.source, p) }));
        setState((s) => ({ projects: [...imported, ...s.projects], activeId: imported[0]!.id }));
        toast.success(`Импортировано проектов: ${imported.length}`);
        setTab('materials');
      } else {
        newProject(text, file.name.replace(/\.[^.]+$/, ''));
        toast.success('Текст загружен — проверьте параметры и соберите материалы');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  };

  const removeProject = () => {
    if (!project) return;
    const removed = project;
    const idx = state.projects.indexOf(removed);
    setState((s) => {
      const rest = s.projects.filter((p) => p.id !== removed.id);
      return { projects: rest, activeId: rest[0]?.id ?? null };
    });
    toast.success(`Проект «${removed.name}» удалён`, {
      action: {
        label: 'Отменить',
        onClick: () =>
          setState((s) => {
            const next = [...s.projects];
            next.splice(Math.min(idx, next.length), 0, removed);
            return { projects: next, activeId: removed.id };
          }),
      },
    });
  };

  const reset = async () => {
    await clearProductData('content-os');
    setState(INITIAL);
    setConfirmReset(false);
    toast.success('Проекты Content OS удалены из браузера');
  };

  const actions = project ? (
    <>
      <label className="sr-only" htmlFor="co-project">
        Проект
      </label>
      <select id="co-project" className="select" style={{ height: 32, maxWidth: 220 }} value={project.id} onChange={(e) => setState((s) => ({ ...s, activeId: e.target.value }))}>
        {state.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => newProject()}>
        <Icon name="plus" /> <span className="hide-sm">Проект</span>
      </button>
      <UploadButton accept=".txt,.md,.markdown,.json" onFile={(f) => void openSourceFile(f)}>
        Импорт
      </UploadButton>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        disabled={!project.items.length}
        onClick={() => downloadFile(`${safeFilename(project.name)}-${stamp()}.md`, projectToMarkdown(project), 'text/markdown;charset=utf-8')}
        data-testid="co-export-md"
      >
        <Icon name="download" /> .md
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => downloadFile(`noro-content-projects-${stamp()}.json`, JSON.stringify({ format: 'noro-content-os', version: 1, projects: state.projects }, null, 2), 'application/json')}
      >
        <Icon name="download" /> JSON
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={removeProject} aria-label="Удалить проект">
        <Icon name="trash" />
      </button>
    </>
  ) : null;

  return (
    <AppFrame
      icon="layers"
      name="Content OS"
      source={project ? `${project.name} · ${project.items.length} материалов · проектов: ${state.projects.length}` : 'Нет проектов'}
      actions={actions}
      panel={project ? { base: 'co', tabKey: tab } : undefined}
      nav={
        project ? (
          <Tabs<TabKey>
            label="Разделы Content OS"
            idBase="co"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'project', label: 'Исходник', icon: 'fileText' },
              { key: 'materials', label: 'Материалы', icon: 'layers', count: project.items.length || undefined },
              { key: 'calendar', label: 'Календарь', icon: 'calendar' },
            ]}
          />
        ) : null
      }
      status={
        <StorageStatus
          saveError={store.saveError}
          extra={
            <>
              <span>
                <Icon name="plug" size={12} /> Черновики: шаблоны + тезисы (без ИИ) · автопостинг не подключён
              </span>
              {state.projects.length ? (
                <button type="button" className="btn btn--ghost btn--sm" style={{ height: 24, fontSize: '0.72rem' }} onClick={() => setConfirmReset(true)}>
                  Удалить всё
                </button>
              ) : null}
            </>
          }
        />
      }
    >
      {!loaded ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !project ? (
        <StartPanel
          title="Один исходник — пакет публикаций для всех площадок"
          text="Вставьте статью или расшифровку. Content OS выделит тезисы и ключевые слова, соберёт черновики под Telegram, VK, Дзен, email, YouTube и короткие видео, проверит длину и поставит материалы в календарь."
          steps={['Откройте демо-проект или вставьте свой текст', 'Выберите тон, аудиторию и площадки', 'Отредактируйте черновики — версии сохраняются', 'Расставьте даты в календаре и выгрузите пакет']}
          onDemo={startDemo}
          upload={
            <FileDrop accept=".txt,.md,.markdown,.json" title="Загрузите свой текст" hint=".txt или .md до 2 МБ (от 300 символов). Или JSON-экспорт проектов NORO." busy={busy} onFile={(f) => void openSourceFile(f)}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => newProject()}>
                <Icon name="edit" /> Вставить текст вручную
              </button>
            </FileDrop>
          }
        />
      ) : (
        <>
          {tab === 'project' ? <ProjectTab project={project} onChange={(patch) => patchProject(project.id, (p) => ({ ...p, ...patch }))} onBuild={() => build(project)} /> : null}
          {tab === 'materials' ? (
            <MaterialsTab
              key={`${project.id}-${focus ?? ''}`}
              project={project}
              initialItemId={focus}
              updateItem={updateItem}
              onRebuild={(overwrite) => build(project, { overwrite })}
              onVariant={() => build(project, { variant: project.variant + 1 })}
              goToProject={() => setTab('project')}
            />
          ) : null}
          {tab === 'calendar' ? (
            <CalendarTab
              projects={state.projects}
              activeProjectId={project.id}
              moveItem={(pid, iid, date) => patchProject(pid, (p) => ({ ...p, items: p.items.map((i) => (i.id === iid ? { ...i, date } : i)) }))}
              openItem={(pid, iid) => {
                setState((s) => ({ ...s, activeId: pid }));
                setFocus(iid);
                setTab('materials');
              }}
            />
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={confirmReset}
        title="Удалить все проекты Content OS?"
        message="Все проекты, черновики, история версий и календарь будут удалены из этого браузера. Перед удалением можно выгрузить JSON."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
