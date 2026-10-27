import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { ItemTile } from '../components/content';
import { Badge, Empty, Loading, Notice } from '../components/ui';
import { useWs, useWsApi } from '../session';
import type { ItemRow, ProviderConfig, ProviderInfo } from '../types';

export function MotionPage() {
  const { ws, base } = useWs();
  const u = useWsApi();
  const items = useQuery({ queryKey: ['items', ws.id, 'motion'], queryFn: () => api.get<ItemRow[]>(u('/items?kind=video,video_script')), refetchInterval: 8000 });
  const prov = useQuery({ queryKey: ['providers', ws.id], queryFn: () => api.get<{ catalog: ProviderInfo[]; configured: ProviderConfig[] }>(u('/providers')) });
  if (items.isLoading) return <Loading />;
  const videos = items.data?.filter((i) => i.kind === 'video') ?? [];
  const scripts = items.data?.filter((i) => i.kind === 'video_script') ?? [];
  const tts = prov.data?.configured.find((p) => p.kind === 'tts');
  const piper = prov.data?.catalog.find((c) => c.id === 'piper');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Motion Studio</h1>
          <p>Сценарий → раскадровка → озвучка по сценам → субтитры, синхронизированные с голосом → анимированный ролик с интерфейсными элементами. Вертикаль 9:16 по умолчанию, также 1:1 и 16:9.</p>
        </div>
      </div>
      <div className="grid g3">
        <div className="card stat"><div className="label">Готовых роликов</div><div className="value">{videos.filter((v) => v.assets.some((a) => a.kind === 'video')).length}</div><div className="sub">{videos.filter((v) => v.status === 'generating').length} рендерится</div></div>
        <div className="card stat"><div className="label">Сценариев</div><div className="value">{scripts.length}</div><div className="sub">Видео создаётся из сценария кнопкой «Сделать видео»</div></div>
        <div className="card stat">
          <div className="label">Озвучка</div>
          <div className="value" style={{ fontSize: 18, marginTop: 10 }}>{tts ? tts.label : piper?.available ? 'Piper (локально)' : 'не настроена'}</div>
          <div className="sub">{tts ? 'по умолчанию' : piper?.available ? 'бесплатно, без ключа' : 'npm run tts:setup или ключ ElevenLabs/OpenAI'}</div>
        </div>
      </div>
      {!tts && !piper?.available && <Notice tone="warn">Нет провайдера озвучки: ролики можно рендерить только без голоса. Установите бесплатный Piper (<span className="mono">npm run tts:setup</span>) или добавьте ключ в настройках.</Notice>}
      <h2>Ролики</h2>
      {videos.length ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {videos.map((v) => <ItemTile key={v.id} item={v} base={base} />)}
        </div>
      ) : (
        <div className="card"><Empty title="Роликов пока нет">Откройте сценарий и нажмите «Сделать видео».</Empty></div>
      )}
      <h2>Сценарии</h2>
      {scripts.length ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Сценарий</th><th>Сцен</th><th>Длительность</th><th>Кампания</th><th /></tr></thead>
            <tbody>
              {scripts.map((s) => {
                const scenes = (s.version?.data.scenes as { durationSec: number }[] | undefined) ?? [];
                return (
                  <tr key={s.id}>
                    <td><Link to={`${base}/items/${s.id}`} style={{ fontWeight: 600 }}>{s.title}</Link>{s.version?.source === 'test' && <> <Badge tone="test">ТЕСТ</Badge></>}{s.version?.source === 'demo' && <> <Badge tone="demo">ДЕМО</Badge></>}</td>
                    <td className="mono">{scenes.length}</td>
                    <td className="mono">≈{scenes.reduce((a, x) => a + x.durationSec, 0).toFixed(0)} с</td>
                    <td className="small muted">{s.campaignTitle}</td>
                    <td><Link className="btn xs" to={`${base}/items/${s.id}`}>Открыть</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card"><Empty title="Сценариев нет">Добавьте формат «Сценарий видео» в бриф кампании.</Empty></div>
      )}
    </div>
  );
}
