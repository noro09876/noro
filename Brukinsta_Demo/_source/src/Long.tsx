import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing, random} from 'remotion';
import {C, F, loadFonts} from './theme';
import {Bg, Window, Chip, Avatar, KTitle, Kicker, SceneWrap, Flash, Icon, FlowLine, useSpring, useT, clamp} from './components/ui';
import {Captions} from './components/Captions';
import {sceneTiming, Timeline} from './timeline';
import data from './data/long.json';

const tl = data as Timeline;
const OVER = 0.2;
const ST = (id: string) => sceneTiming(tl, id, OVER);
type IconName = React.ComponentProps<typeof Icon>['name'];

const LAYERS = ['Процессы', 'Данные', 'Интеграции', 'ИИ', 'Контроль'];
const LAYER_ICONS: IconName[] = ['flag', 'db', 'bolt', 'spark', 'eye'];

/* ───────────── общие элементы ───────────── */

/** Фаза внутри сцены: плавный вход/выход блока между моментами from и to. */
const Phase: React.FC<{from: number; to?: number; children: React.ReactNode; dir?: 'up' | 'left' | 'fade'}> = ({from, to = 9999, children, dir = 'up'}) => {
  const t = useT();
  const a = interpolate(t, [from - 0.05, from + 0.35], [0, 1], {...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const b = interpolate(t, [to - 0.25, to + 0.05], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  if (a <= 0 || b >= 1) return null;
  const tr = dir === 'left' ? `translateX(${(1 - a) * 220 - b * 220}px)` : dir === 'up' ? `translateY(${(1 - a) * 80 - b * 60}px)` : 'none';
  return <AbsoluteFill style={{opacity: a * (1 - b), transform: tr, filter: a < 1 || b > 0 ? `blur(${(1 - a) * 10 + b * 10}px)` : undefined}}>{children}</AbsoluteFill>;
};

/** Появление элемента на пружине. */
const Pop: React.FC<{at: number; children: React.ReactNode; style?: React.CSSProperties; from?: 'up' | 'left' | 'right' | 'scale'}> = ({at, children, style, from = 'up'}) => {
  const s = useSpring(at, {damping: 15, stiffness: 160});
  const tr = from === 'up' ? `translateY(${(1 - s) * 50}px)` : from === 'left' ? `translateX(${(1 - s) * -80}px)` : from === 'right' ? `translateX(${(1 - s) * 80}px)` : `scale(${0.6 + 0.4 * s})`;
  return <div style={{position: 'absolute', opacity: Math.min(1, s * 1.4), transform: tr, ...style}}>{children}</div>;
};

const Card: React.FC<{children: React.ReactNode; style?: React.CSSProperties; accent?: string}> = ({children, style, accent}) => (
  <div style={{background: C.surface, border: `2px solid ${accent ?? C.line}`, borderRadius: 24, boxShadow: '0 24px 60px #00000080', ...style}}>{children}</div>
);

const Label: React.FC<{children: React.ReactNode; color?: string; size?: number}> = ({children, color = C.muted, size = 20}) => (
  <div style={{fontFamily: F.mono, fontWeight: 700, fontSize: size, color, letterSpacing: '0.1em', textTransform: 'uppercase'}}>{children}</div>
);

const Txt: React.FC<{children: React.ReactNode; size?: number; color?: string; w?: number; style?: React.CSSProperties}> = ({children, size = 28, color = C.text, w = 800, style}) => (
  <div style={{fontFamily: F.body, fontWeight: w, fontSize: size, color, lineHeight: 1.3, ...style}}>{children}</div>
);

/** Стек из пяти слоёв системы (используется в promise и recap). */
const LayerStack: React.FC<{x: number; y: number; times: number[]; lit?: number}> = ({x, y, times, lit = 1}) => {
  const t = useT();
  return (
    <div style={{position: 'absolute', left: x, top: y, width: 640, height: 600}}>
      {LAYERS.map((name, i) => {
        const at = times[i];
        const s = useSpring(at, {damping: 14, stiffness: 150});
        const level = 4 - i; // процессы внизу
        const glow = lit && t > at ? 1 : 0;
        return (
          <div key={name} style={{position: 'absolute', left: 0, top: level * 112, width: 640, height: 96, transform: `translateY(${(1 - s) * -120}px) perspective(900px) rotateX(${(1 - s) * 50}deg)`, opacity: s, borderRadius: 22, background: `linear-gradient(90deg, ${C.surface2}, ${C.surface})`, border: `2px solid ${glow ? C.accent + 'AA' : C.line}`, display: 'flex', alignItems: 'center', gap: 22, padding: '0 28px', boxShadow: glow ? `0 0 40px ${C.accent}22` : 'none'}}>
            <div style={{width: 56, height: 56, borderRadius: 16, background: glow ? C.accent : C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <Icon name={LAYER_ICONS[i]} size={32} color={glow ? C.bg : C.accent} />
            </div>
            <div style={{fontFamily: F.mono, fontSize: 22, color: C.muted}}>0{i + 1}</div>
            <div style={{fontFamily: F.display, fontWeight: 800, fontSize: 34, color: C.text, textTransform: 'uppercase', letterSpacing: '-0.01em'}}>{name}</div>
          </div>
        );
      })}
    </div>
  );
};

/** Узел процесса. */
const Node: React.FC<{x: number; y: number; w?: number; icon: IconName; title: string; sub?: string; at: number; color?: string; active?: boolean; danger?: string}> = ({x, y, w = 230, icon, title, sub, at, color = C.accent, active, danger}) => {
  const s = useSpring(at, {damping: 14, stiffness: 170});
  return (
    <div style={{position: 'absolute', left: x, top: y, width: w, opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${0.85 + 0.15 * s})`}}>
      <div style={{padding: '20px 18px', borderRadius: 22, background: active ? `${color}18` : C.surface, border: `2px solid ${danger ? C.danger : active ? color : C.line}`, minHeight: 150, boxShadow: active ? `0 0 40px ${color}33` : '0 20px 40px #00000070'}}>
        <div style={{width: 52, height: 52, borderRadius: 16, background: active ? color : C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14}}>
          <Icon name={icon} size={30} color={active ? C.bg : color} />
        </div>
        <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 24, color: C.text, lineHeight: 1.2}}>{title}</div>
        {sub && <div style={{fontFamily: F.mono, fontSize: 17, color: C.muted, marginTop: 8}}>{sub}</div>}
      </div>
      {danger && (
        <Pop at={at} style={{left: 0, top: -24}}>
          <Chip size={17} color={C.bg} bg={C.danger}>{danger}</Chip>
        </Pop>
      )}
    </div>
  );
};

/* ───────────── сцены ───────────── */

const Intro: React.FC = () => {
  const {L, dur} = ST('intro');
  const t = useT();
  const tools: {n: string; i: IconName}[] = [{n: 'Тексты', i: 'doc'}, {n: 'Ответы клиентам', i: 'dm'}, {n: 'Отчёты', i: 'chart'}];
  const chaos = ['CRM', 'Таблица продаж', 'Чат-бот', 'Почта', 'Excel менеджера', 'Нейросеть', 'Мессенджер', 'Бухгалтерия'];
  const dim = interpolate(t, [L[3] - 0.2, L[3] + 0.4], [0, 1], clamp);
  return (
    <SceneWrap dur={dur + OVER} enter="none" exit="whipLeft">
      <Phase from={0} to={L[1]}>
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <Kicker at={0.1}>искусственный интеллект в бизнесе</Kicker>
          <div style={{height: 30}} />
          <KTitle lines={['ИИ уже есть', 'почти везде']} at={0.2} size={120} accentWords={['везде']} />
        </AbsoluteFill>
      </Phase>
      <Phase from={L[1]} to={L[2]}>
        {tools.map((x, i) => (
          <Pop key={x.n} at={L[1] + 0.3 + i * 0.9} style={{left: 200 + i * 540, top: 330}}>
            <Window title={`ии · ${x.n.toLowerCase()}`} w={460} h={330}>
              <div style={{padding: 30, display: 'flex', flexDirection: 'column', gap: 18}}>
                <Icon name={x.i} size={60} color={C.accent} />
                <Txt size={38}>{x.n}</Txt>
                {[0.9, 0.7, 0.8].map((w, k) => <div key={k} style={{height: 12, width: `${w * 100}%`, borderRadius: 6, background: C.line}} />)}
              </div>
            </Window>
          </Pop>
        ))}
      </Phase>
      <Phase from={L[2]} to={dur + 1} dir="fade">
        <AbsoluteFill style={{filter: `brightness(${1 - dim * 0.6}) blur(${dim * 6}px)`}}>
          {chaos.map((n, i) => {
            const x = 140 + (i % 4) * 420 + (random(`cx${i}`) - 0.5) * 120;
            const y = 160 + Math.floor(i / 4) * 340 + (random(`cy${i}`) - 0.5) * 80;
            const r = (random(`cr${i}`) - 0.5) * 12;
            return (
              <Pop key={n} at={L[2] + i * 0.18} from="scale" style={{left: x, top: y + Math.sin(t * 1.3 + i) * 8, transform: `rotate(${r}deg)`}}>
                <Window title={n.toLowerCase()} w={330} h={220}>
                  <div style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 12}}>
                    {[0.9, 0.6, 0.75, 0.5].map((w, k) => <div key={k} style={{height: 10, width: `${w * 100}%`, borderRadius: 5, background: C.line}} />)}
                  </div>
                </Window>
              </Pop>
            );
          })}
          <svg style={{position: 'absolute', inset: 0}} width={1920} height={1080}>
            {Array.from({length: 7}).map((_, i) => {
              const p = interpolate(t, [L[2] + 1 + i * 0.3, L[2] + 1.6 + i * 0.3], [0, 1], clamp);
              const x1 = 300 + (i * 290) % 1500, y1 = 260 + (i % 2) * 340, x2 = 380 + ((i + 3) * 370) % 1400, y2 = 600 - (i % 2) * 300;
              return <path key={i} d={`M${x1},${y1} C${x1 + 300},${y1 - 200} ${x2 - 300},${y2 + 200} ${x2},${y2}`} stroke={C.danger} strokeWidth={3} fill="none" strokeDasharray="10 12" opacity={0.7 * p} />;
            })}
          </svg>
          {[0, 1, 2].map((i) => (
            <Pop key={i} at={L[2] + 2.2 + i * 0.4} style={{left: 360 + i * 520, top: 470 + (i % 2) * 60}}>
              <Chip size={24} color={C.bg} bg={C.danger}>ручная работа</Chip>
            </Pop>
          ))}
        </AbsoluteFill>
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <KTitle lines={['инструменты есть.', 'системы нет.']} at={L[3]} size={110} accentWords={['системы', 'нет.']} accent={C.danger} />
        </AbsoluteFill>
      </Phase>
    </SceneWrap>
  );
};

const PromiseScene: React.FC = () => {
  const {L, W, dur} = ST('promise');
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipLeft" exit="zoom">
      <div style={{position: 'absolute', left: 150, top: 230, width: 940}}>
        <Kicker at={0.1}>в этом ролике</Kicker>
        <div style={{height: 26}} />
        <KTitle lines={['Система', 'автоматизации', 'с ИИ']} at={0.25} size={76} align="left" accentWords={['ИИ']} />
        <Pop at={L[2]} style={{left: 0, top: 440, display: 'flex', gap: 16}}>
          {['5 слоёв', 'пример', 'внедрение'].map((x, i) => (
            <div key={x} style={{display: 'flex', alignItems: 'center', gap: 16}}>
              <Chip size={28} color={i === 0 ? C.bg : C.text} bg={i === 0 ? C.accent : C.surface2}>{x}</Chip>
              {i < 2 && <div style={{fontFamily: F.display, color: C.muted, fontSize: 28}}>→</div>}
            </div>
          ))}
        </Pop>
      </div>
      <LayerStack x={1120} y={170} times={[W('процесс'), W('данн'), W('интеграц'), W('ии', 0) > L[1] ? W('ии', 0) : W('ии', 1), W('контрол')]} />
    </SceneWrap>
  );
};

const Chapter: React.FC<{id: string; num: string; layer?: number}> = ({id, num, layer}) => {
  const {dur, sc} = ST(id);
  const s = useSpring(0.05, {damping: 13, stiffness: 120});
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="zoom" drift={0.06}>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 300, lineHeight: 0.85, color: 'transparent', WebkitTextStroke: `4px ${C.accent}`, transform: `scale(${0.7 + 0.3 * s})`, opacity: s}}>{num}</div>
        <div style={{height: 30}} />
        <KTitle lines={[sc.title ?? '']} at={0.2} size={96} />
        {layer !== undefined && (
          <div style={{display: 'flex', gap: 14, marginTop: 50}}>
            {LAYERS.map((n, i) => (
              <div key={n} style={{padding: '12px 22px', borderRadius: 999, fontFamily: F.mono, fontWeight: 700, fontSize: 20, background: i === layer ? C.accent : 'transparent', color: i === layer ? C.bg : i < layer ? C.text : C.muted, border: `2px solid ${i === layer ? C.accent : C.line}`, opacity: s}}>
                {n.toUpperCase()}
              </div>
            ))}
          </div>
        )}
      </AbsoluteFill>
    </SceneWrap>
  );
};

const ProcMap: React.FC = () => {
  const {L, dur} = ST('procmap');
  const t = useT();
  const steps: {i: IconName; t: string; who: string}[] = [
    {i: 'dm', t: 'Заявка приходит', who: 'клиент'},
    {i: 'table', t: 'Копируют в таблицу', who: 'менеджер'},
    {i: 'plane', t: 'Пересылают в чат', who: 'менеджер'},
    {i: 'clock', t: 'Ждут согласования', who: 'руководитель'},
    {i: 'doc', t: 'Готовят предложение', who: 'менеджер'},
    {i: 'check', t: 'Отправляют клиенту', who: 'менеджер'},
  ];
  const marks: Record<number, string> = {1: 'повторный ввод', 2: 'ручная пересылка', 3: 'работа стоит'};
  const meters = [[3, 1, 2], [3, 2, 2], [3, 1, 3], [2, 3, 3], [2, 3, 2], [3, 1, 3]];
  const x0 = 120, gap = 50, w = 230;
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <div style={{position: 'absolute', left: 120, top: 120, right: 120}}>
        <Phase from={0} to={L[1] - 0.1}>
          <div style={{position: 'absolute', left: 0, top: 160}}>
            <KTitle lines={['Не с выбора нейросети,', 'а с понимания процесса']} at={0.2} size={78} align="left" accentWords={['понимания', 'процесса']} />
          </div>
        </Phase>
      </div>
      <Phase from={L[1] - 0.1}>
        <div style={{position: 'absolute', left: 120, top: 120}}><Kicker at={L[1]}>карта процесса · обработка заявки</Kicker></div>
        {steps.map((s, i) => {
          const at = L[1] + 0.4 + i * 0.75;
          const x = x0 + i * (w + gap);
          const danger = t > L[3] + 0.6 + (i - 1) * 1.0 && marks[i] ? marks[i] : undefined;
          return (
            <React.Fragment key={s.t}>
              {i > 0 && <FlowLine x1={x - gap + 4} y1={400} x2={x - 6} y2={400} at={at - 0.2} dur={0.25} color={danger ? C.danger : C.accent} width={3} packet={false} />}
              <Node x={x} y={320} w={w} icon={s.i} title={s.t} sub={s.who} at={at} danger={danger} />
              <Pop at={L[2] + 0.5 + i * 0.25} style={{left: x, top: 540, width: w}}>
                <Card style={{padding: 16, display: 'flex', flexDirection: 'column', gap: 10}}>
                  {['частота', 'время', 'риск'].map((m, k) => (
                    <div key={m} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <span style={{fontFamily: F.mono, fontSize: 17, color: C.muted}}>{m}</span>
                      <span style={{display: 'flex', gap: 5}}>
                        {[0, 1, 2].map((d) => <span key={d} style={{width: 18, height: 8, borderRadius: 4, background: d < meters[i][k] ? (k === 2 ? C.danger : C.accent) : C.line}} />)}
                      </span>
                    </div>
                  ))}
                </Card>
              </Pop>
            </React.Fragment>
          );
        })}
        <Pop at={L[3] + 0.2} style={{left: 120, top: 760}}>
          <Txt size={30} w={700} color={C.muted}>На карте сразу видно, <span style={{color: C.danger}}>где теряется время</span></Txt>
        </Pop>
      </Phase>
    </SceneWrap>
  );
};

const Criteria: React.FC = () => {
  const {L, dur} = ST('criteria');
  const items: {i: IconName; t: string; s: string}[] = [
    {i: 'clock', t: 'Повторяется часто', s: 'каждый день или каждую неделю'},
    {i: 'flag', t: 'Понятные правила', s: 'можно описать «если — то»'},
    {i: 'db', t: 'Цифровые данные', s: 'текст, таблица, форма, письмо'},
    {i: 'bolt', t: 'Ошибка стоит дорого', s: 'деньги, клиенты, сроки'},
  ];
  const stamp = useSpring(L[5], {damping: 10, stiffness: 180});
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipLeft" exit="zoom">
      <div style={{position: 'absolute', left: 120, top: 120}}>
        <KTitle lines={['4 признака', 'хорошего кандидата']} at={0.1} size={64} align="left" accentWords={['4']} />
      </div>
      {items.map((x, i) => (
        <Pop key={x.t} at={L[i + 1] - 0.1} from="scale" style={{left: 120 + (i % 2) * 840, top: 330 + Math.floor(i / 2) * 230, width: 800}}>
          <Card style={{padding: 30, display: 'flex', gap: 26, alignItems: 'center', height: 190}} accent={`${C.accent}55`}>
            <div style={{width: 92, height: 92, borderRadius: 26, background: `${C.accent}1C`, border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
              <Icon name={x.i} size={48} color={C.accent} />
            </div>
            <div style={{flex: 1}}>
              <Txt size={38}>{x.t}</Txt>
              <Txt size={25} w={500} color={C.muted} style={{marginTop: 6}}>{x.s}</Txt>
            </div>
            <Icon name="check" size={52} color={C.accent} stroke={3} />
          </Card>
        </Pop>
      ))}
      <div style={{position: 'absolute', right: 140, top: 130, transform: `rotate(-4deg) scale(${0.5 + 0.5 * stamp})`, opacity: stamp, padding: '22px 36px', borderRadius: 20, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 900, fontSize: 40}}>
        3–4 ИЗ 4 → НАЧИНАЙТЕ
      </div>
    </SceneWrap>
  );
};

const DataScene: React.FC = () => {
  const {L, dur} = ST('data');
  const t = useT();
  const sources = ['Таблица продаж', 'Таблица маркетинга', 'Excel менеджера', 'Переписка в телефоне'];
  const merge = interpolate(t, [L[2] + 0.3, L[2] + 1.4], [0, 1], {...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1)});
  const fields = [
    ['Телефон', '+7 XXX XXX-XX-XX', 'обязательно'],
    ['Источник', 'сайт · директ · телеграм', 'обязательно'],
    ['Сумма', '0 000 ₽', 'формат'],
    ['Статус', 'новая → в работе → сделка', 'список'],
    ['Ответственный', 'один человек', 'обязательно'],
  ];
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <Phase from={0} to={L[1]}>
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <KTitle lines={['ИИ работает', 'с тем, что видит']} at={0.15} size={110} accentWords={['видит']} />
        </AbsoluteFill>
      </Phase>
      <Phase from={L[1]} to={L[3]} dir="fade">
        {sources.map((s, i) => {
          const sx = 150 + (i % 2) * 1150 + (i > 1 ? 80 : 0), sy = 170 + Math.floor(i / 2) * 340;
          const x = sx + (760 - sx) * merge, y = sy + (360 - sy) * merge;
          return (
            <Pop key={s} at={L[1] + 0.2 + i * 0.4} from="scale" style={{left: x, top: y, transform: `scale(${1 - merge * 0.6}) rotate(${(1 - merge) * (i % 2 ? 4 : -4)}deg)`, opacity: 1 - merge * 0.9}}>
              <Window title={s.toLowerCase()} w={400} h={250}>
                <div style={{padding: 18, display: 'flex', flexDirection: 'column', gap: 10}}>
                  {['Иван П.', 'иван петров', 'Петров И.'].map((n, k) => (
                    <div key={k} style={{display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 19, color: C.muted, padding: '6px 10px', background: C.surface2, borderRadius: 8}}>
                      <span>{n}</span><span>{['+7900…', '8-900-…', '—'][k]}</span>
                    </div>
                  ))}
                </div>
              </Window>
              {merge < 0.1 && <div style={{position: 'absolute', top: -18, right: 20}}><Chip size={18} color={C.bg} bg={C.danger}>{['дубли', 'разные форматы', 'устарело', 'не найти'][i]}</Chip></div>}
            </Pop>
          );
        })}
        <Pop at={L[2] + 1.1} from="scale" style={{left: 660, top: 230}}>
          <Card accent={C.accent} style={{width: 600, padding: 34, boxShadow: `0 0 80px ${C.accent}33`}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
              <Icon name="db" size={54} color={C.accent} />
              <div>
                <Label color={C.accent}>один источник правды</Label>
                <Txt size={40} style={{marginTop: 4}}>CRM · единая база</Txt>
              </div>
            </div>
            <div style={{marginTop: 26, display: 'flex', gap: 18, alignItems: 'center', padding: 20, background: C.surface2, borderRadius: 18}}>
              <Avatar letter="И" size={64} color={C.info} />
              <div>
                <Txt size={30}>Иван Петров</Txt>
                <Txt size={22} w={500} color={C.muted}>одна карточка · вся история</Txt>
              </div>
            </div>
          </Card>
        </Pop>
      </Phase>
      <Phase from={L[3]} dir="left">
        <div style={{position: 'absolute', left: 120, top: 150, width: 600}}>
          <Kicker at={L[3]}>договорённости о данных</Kicker>
          <div style={{height: 24}} />
          <KTitle lines={['Скучная часть,', 'на которой', 'держится всё']} at={L[4] - 0.1} size={62} align="left" accentWords={['держится', 'всё']} />
        </div>
        <div style={{position: 'absolute', left: 820, top: 150, width: 980}}>
          <Window title="схема карточки клиента" w={980} h={620} accent={`${C.accent}55`}>
            <div style={{padding: '18px 30px'}}>
              {fields.map(([k, v, tag], i) => (
                <Pop key={k} at={L[3] + 0.3 + i * 0.35} from="left" style={{position: 'relative', display: 'flex', alignItems: 'center', height: 100, borderBottom: `2px solid ${C.line}`, width: 920}}>
                  <div style={{width: 260, fontFamily: F.body, fontWeight: 800, fontSize: 30, color: C.text}}>{k}</div>
                  <div style={{flex: 1, fontFamily: F.mono, fontSize: 24, color: C.muted}}>{v}</div>
                  <Chip size={19} color={tag === 'обязательно' ? C.bg : C.text} bg={tag === 'обязательно' ? C.accent : C.surface2}>{tag}</Chip>
                </Pop>
              ))}
            </div>
          </Window>
        </div>
      </Phase>
    </SceneWrap>
  );
};

const Block: React.FC<{x: number; y: number; w: number; h: number; label: string; color: string; at: number; children?: React.ReactNode; icon: IconName}> = ({x, y, w, h, label, color, at, children, icon}) => (
  <Pop at={at} from="scale" style={{left: x, top: y}}>
    <div style={{width: w, height: h, borderRadius: 28, background: C.surface, border: `2px solid ${color}`, boxShadow: `0 0 50px ${color}22`, padding: 30, display: 'flex', flexDirection: 'column', gap: 16}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <Icon name={icon} size={38} color={color} />
        <Label color={color} size={24}>{label}</Label>
      </div>
      {children}
    </div>
  </Pop>
);

const Triggers: React.FC = () => {
  const {L, W, dur} = ST('triggers');
  const t = useT();
  const second = t > L[4] - 0.2;
  const ex = second
    ? {ev: 'Счёт оплачен', cond: 'оплата прошла полностью', acts: ['Статус сделки → «оплачено»', 'Уведомить бухгалтера', 'Отправить клиенту документы']}
    : {ev: 'Новая заявка с сайта', cond: 'источник = реклама\nи рабочее время', acts: ['Создать карточку в CRM', 'Назначить менеджера', 'Ответить клиенту']};
  const swap = interpolate(t, [L[4] - 0.3, L[4] - 0.05, L[4] + 0.25], [1, 0, 1], clamp);
  const bw = 480, by = 300;
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <Phase from={0} to={L[5] - 0.1}>
        <div style={{position: 'absolute', left: 120, top: 110}}>
          <KTitle lines={['событие → условие → действие']} at={0.2} size={58} align="left" accentWords={['действие']} />
        </div>
        <div style={{opacity: swap}}>
          <Block x={120} y={by} w={bw} h={420} label="событие" color={C.info} at={W('событие', 0) - 0.1} icon="bell">
            {t > L[1] - 0.1 && <Pop at={L[1]} style={{position: 'relative'}}><Txt size={38}>{ex.ev}</Txt></Pop>}
          </Block>
          <Block x={720} y={by} w={bw} h={420} label="условие" color="#FFC23A" at={W('условие', 0) - 0.1} icon="flag">
            {t > L[2] - 0.1 && <Pop at={L[2]} style={{position: 'relative'}}><Txt size={34} style={{whiteSpace: 'pre-line', fontFamily: F.mono, fontWeight: 500}}>{ex.cond}</Txt></Pop>}
          </Block>
          <Block x={1320} y={by} w={bw} h={420} label="действия" color={C.accent} at={W('действие', 0) - 0.1} icon="bolt">
            {ex.acts.map((a, i) => t > L[3] - 0.1 && (
              <Pop key={a} at={(second ? L[4] + 0.6 : L[3]) + i * 0.45} style={{position: 'relative'}}>
                <div style={{display: 'flex', gap: 12, alignItems: 'center', padding: '14px 16px', borderRadius: 14, background: C.surface2}}>
                  <Icon name="check" size={28} color={C.accent} stroke={3} />
                  <Txt size={25} w={700}>{a}</Txt>
                </div>
              </Pop>
            ))}
          </Block>
          <FlowLine x1={610} y1={by + 210} x2={712} y2={by + 210} at={W('условие', 0)} dur={0.3} color={C.info} />
          <FlowLine x1={1210} y1={by + 210} x2={1312} y2={by + 210} at={W('действие', 0)} dur={0.3} color="#FFC23A" />
          {second && <Pop at={L[4] - 0.1} style={{left: 120, top: 760}}><Chip size={22} color={C.bg} bg={C.accent}>пример 2</Chip></Pop>}
        </div>
      </Phase>
      <Phase from={L[5] - 0.1}>
        {(() => {
          const apps: {n: string; i: IconName}[] = [{n: 'Сайт', i: 'globe'}, {n: 'CRM', i: 'db'}, {n: 'Мессенджер', i: 'dm'}, {n: 'Почта', i: 'doc'}, {n: 'Таблицы', i: 'table'}, {n: 'Нейросеть', i: 'spark'}];
          const cx = 960, cy = 470, R = 330;
          return (
            <>
              {apps.map((a, i) => {
                const ang = (i / apps.length) * Math.PI * 2 - Math.PI / 2;
                const x = cx + Math.cos(ang) * R * 1.45, y = cy + Math.sin(ang) * R * 0.95;
                return (
                  <React.Fragment key={a.n}>
                    <FlowLine x1={x} y1={y} x2={cx} y2={cy} at={L[5] + 0.3 + i * 0.15} dur={0.4} color={C.accent} width={3} />
                    <Pop at={L[5] + 0.2 + i * 0.15} from="scale" style={{left: x - 110, top: y - 50}}>
                      <Card style={{width: 220, height: 100, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px'}}>
                        <Icon name={a.i} size={36} color={C.accent} />
                        <Txt size={26}>{a.n}</Txt>
                      </Card>
                    </Pop>
                  </React.Fragment>
                );
              })}
              <Pop at={L[5]} from="scale" style={{left: cx - 190, top: cy - 90}}>
                <div style={{width: 380, height: 180, borderRadius: 32, background: C.accent, color: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 90px ${C.accent}55`}}>
                  <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 34}}>ИНТЕГРАЦИИ</div>
                  <div style={{fontFamily: F.mono, fontWeight: 700, fontSize: 22, marginTop: 8}}>сервис связок · API</div>
                </div>
              </Pop>
            </>
          );
        })()}
      </Phase>
    </SceneWrap>
  );
};

const AiTasks: React.FC = () => {
  const {L, W, dur} = ST('aitasks');
  const t = useT();
  const tasks: {i: IconName; t: string; s: string; k: string}[] = [
    {i: 'flag', t: 'Определить тему', s: 'вопрос, жалоба, заказ', k: 'тему'},
    {i: 'doc', t: 'Извлечь реквизиты', s: 'из письма или счёта', k: 'реквизит'},
    {i: 'dm', t: 'Черновик ответа', s: 'по базе знаний', k: 'черновик'},
    {i: 'spark', t: 'Сводка созвона', s: 'итоги и задачи', k: 'сводку'},
  ];
  const wave = Array.from({length: 40}).map((_, i) => 10 + Math.abs(Math.sin(i * 0.7 + t * 6) * Math.sin(i * 0.23)) * 60);
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="none">
      <Phase from={0} to={L[2] - 0.1}>
        <div style={{position: 'absolute', left: 120, top: 150, width: 790}}>
          <Label color={C.text} size={26}>Чёткие правила</Label>
          <Pop at={0.2} style={{position: 'relative', marginTop: 24}}>
            <Card style={{padding: 34, fontFamily: F.mono, fontSize: 30, lineHeight: 1.6, color: C.muted, width: 720}}>
              <span style={{color: C.info}}>если</span> сумма &gt; лимита<br />
              <span style={{color: C.info}}>то</span> отправить на согласование<br />
              <span style={{color: C.info}}>иначе</span> провести автоматически
            </Card>
          </Pop>
          <Pop at={0.8} style={{position: 'relative', marginTop: 24}}><Chip size={24} color={C.bg} bg={C.info}>обычная автоматизация</Chip></Pop>
        </div>
        <div style={{position: 'absolute', left: 960, top: 120, width: 4, height: 700, background: C.line}} />
        <div style={{position: 'absolute', left: 1010, top: 150, width: 790}}>
          <Label color={C.text} size={26}>Размытые данные</Label>
          <Pop at={L[1]} style={{position: 'relative', marginTop: 24}}>
            <Card style={{padding: 30, width: 760, display: 'flex', flexDirection: 'column', gap: 22}}>
              <Txt size={26} w={600} color={C.muted}>«Добрый день, у нас опять не приходят уведомления, и ещё хотели уточнить по счёту…»</Txt>
              <div style={{display: 'flex', alignItems: 'center', gap: 4, height: 70}}>
                {wave.map((h, i) => <div key={i} style={{width: 10, height: h, borderRadius: 5, background: C.accent, opacity: 0.8}} />)}
              </div>
              <div style={{display: 'flex', gap: 14}}>
                <Chip size={22}>текст</Chip><Chip size={22}>речь</Chip><Chip size={22}>документы</Chip>
              </div>
            </Card>
          </Pop>
          <Pop at={L[1] + 0.6} style={{position: 'relative', marginTop: 24}}><Chip size={24} color={C.bg} bg={C.accent}>здесь нужен ИИ</Chip></Pop>
        </div>
      </Phase>
      <Phase from={L[2] - 0.1}>
        <div style={{position: 'absolute', left: 120, top: 120}}>
          <KTitle lines={['Что ИИ делает', 'в системе']} at={L[2]} size={64} align="left" accentWords={['ИИ']} />
        </div>
        {tasks.map((x, i) => {
          const at = W(x.k) - 0.15;
          const on = t > at;
          return (
            <Pop key={x.t} at={at} from="up" style={{left: 120 + i * 425, top: 400, width: 395}}>
              <Card accent={on ? C.accent : C.line} style={{padding: 32, height: 330, display: 'flex', flexDirection: 'column', gap: 18}}>
                <div style={{width: 86, height: 86, borderRadius: 26, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <Icon name={x.i} size={46} color={C.bg} />
                </div>
                <Txt size={34}>{x.t}</Txt>
                <Txt size={24} w={500} color={C.muted}>{x.s}</Txt>
              </Card>
            </Pop>
          );
        })}
      </Phase>
    </SceneWrap>
  );
};

const AiExtract: React.FC = () => {
  const {L, dur} = ST('aiextract');
  const t = useT();
  const scan = ((t - L[1]) * 0.8) % 1;
  const fields = [['Имя', 'Ольга'], ['Компания', '«Север»'], ['Что нужно', 'подключение и консультация'], ['Срочность', 'высокая']];
  const conf = interpolate(t, [L[4] + 0.2, L[4] + 1.2], [0.8, 0.35], clamp);
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="none" exit="whipLeft">
      <Phase from={0} to={L[1] - 0.1}>
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <KTitle lines={['ИИ не принимает', 'решения сам']} at={0.1} size={110} accentWords={['не', 'принимает']} accent={C.danger} />
        </AbsoluteFill>
      </Phase>
      <Phase from={L[1] - 0.1} to={L[3] - 0.1}>
        <Pop at={L[1]} from="left" style={{left: 100, top: 200}}>
          <Window title="входящее письмо" w={560} h={500}>
            <div style={{padding: 28, display: 'flex', flexDirection: 'column', gap: 16}}>
              <Txt size={22} w={600} color={C.muted}>от: olga@sever.example</Txt>
              <Txt size={27} w={600}>Здравствуйте! Мы небольшая компания «Север». Хотим подключиться и получить консультацию — желательно до конца недели. Ольга</Txt>
            </div>
            <div style={{position: 'absolute', left: 0, right: 0, top: `${scan * 100}%`, height: 4, background: C.accent, boxShadow: `0 0 20px ${C.accent}`, opacity: t > L[1] + 0.5 ? 0.8 : 0}} />
          </Window>
        </Pop>
        <FlowLine x1={670} y1={450} x2={790} y2={450} at={L[1] + 0.6} dur={0.3} />
        <Pop at={L[1] + 0.5} from="scale" style={{left: 800, top: 340}}>
          <div style={{width: 220, height: 220, borderRadius: 60, background: `${C.info}22`, border: `3px solid ${C.info}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: `0 0 ${50 + Math.sin(t * 5) * 20}px ${C.info}55`}}>
            <Icon name="spark" size={80} color={C.info} />
            <Label color={C.info} size={22}>ИИ</Label>
          </div>
        </Pop>
        <FlowLine x1={1030} y1={450} x2={1150} y2={450} at={L[2] - 0.2} dur={0.3} />
        <Pop at={L[2] - 0.1} from="right" style={{left: 1160, top: 200}}>
          <Window title="карточка · crm" w={660} h={500} accent={`${C.accent}66`}>
            <div style={{padding: '14px 28px'}}>
              {fields.map(([k, v], i) => (
                <Pop key={k} at={L[2] + 1 + i * 0.6} from="left" style={{position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 92, borderBottom: `2px solid ${C.line}`, width: 600}}>
                  <span style={{fontFamily: F.mono, fontSize: 22, color: C.muted}}>{k}</span>
                  <span style={{fontFamily: F.body, fontWeight: 800, fontSize: 28, color: k === 'Срочность' ? C.danger : C.text}}>{v}</span>
                </Pop>
              ))}
            </div>
          </Window>
        </Pop>
        <Pop at={L[1] + 1.5} style={{left: 1160, top: 730}}><Chip size={22} color={C.bg} bg={C.accent}>дальше работают ваши правила →</Chip></Pop>
      </Phase>
      <Phase from={L[3] - 0.1}>
        <div style={{position: 'absolute', left: 120, top: 120}}>
          <KTitle lines={['Что нужно ИИ', 'для стабильной работы']} at={L[3]} size={58} align="left" accentWords={['стабильной']} />
        </div>
        {[['Инструкции', 'как отвечать и чего не делать', 'doc'], ['Примеры', 'хорошие ответы из практики', 'check'], ['База знаний', 'прайс, регламенты, частые вопросы', 'db']].map(([a, b, ic], i) => (
          <Pop key={a} at={L[3] + 0.5 + i * 0.7} from="left" style={{left: 120, top: 330 + i * 160, width: 760}}>
            <Card style={{padding: '26px 30px', display: 'flex', alignItems: 'center', gap: 24}}>
              <Icon name={ic as IconName} size={46} color={C.accent} />
              <div><Txt size={32}>{a}</Txt><Txt size={23} w={500} color={C.muted}>{b}</Txt></div>
            </Card>
          </Pop>
        ))}
        <Pop at={L[4] - 0.1} from="right" style={{left: 1000, top: 330, width: 800}}>
          <Card style={{padding: 34}} accent={conf < 0.5 ? '#FFC23A' : C.line}>
            <Label size={20}>уверенность модели</Label>
            <div style={{marginTop: 18, height: 26, borderRadius: 13, background: C.surface2, overflow: 'hidden'}}>
              <div style={{width: `${conf * 100}%`, height: '100%', background: conf < 0.5 ? '#FFC23A' : C.accent, borderRadius: 13}} />
            </div>
            <Txt size={28} style={{marginTop: 24}}>{conf < 0.5 ? 'Не уверен → вопрос передан менеджеру' : 'Ответ по базе знаний'}</Txt>
            {conf < 0.5 && <div style={{marginTop: 18, display: 'flex', alignItems: 'center', gap: 14}}><Avatar letter="А" color={C.accent} size={56} /><Txt size={24} w={600} color={C.muted}>Анна получила уведомление</Txt></div>}
          </Card>
        </Pop>
      </Phase>
    </SceneWrap>
  );
};

const Control: React.FC = () => {
  const {L, dur} = ST('control');
  const t = useT();
  const queue = ['Ответ клиенту: «Север»', 'Скидка 10% для заказа', 'Письмо-напоминание об оплате'];
  const logs = ['10:02  создана карточка заявки', '10:02  назначен ответственный: Анна', '10:03  ИИ: тема «подключение», срочно', '10:05  черновик ответа → на проверку', '10:09  ответ утверждён и отправлен', '18:00  напоминание: 2 заявки без движения'];
  const visibleLogs = Math.floor(interpolate(t, [L[2] + 0.2, L[2] + 2.6], [0, logs.length], clamp));
  const auto = interpolate(t, [L[4] + 3.2, L[4] + 3.6], [0, 1], clamp);
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <Phase from={0} to={L[1] - 0.1}>
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <KTitle lines={['человек', '+ прозрачность']} at={0.2} size={120} accentWords={['+', 'прозрачность']} />
        </AbsoluteFill>
      </Phase>
      <Phase from={L[1] - 0.1}>
        <Pop at={L[1]} style={{left: 100, top: 110}}>
          <Window title="на проверке" w={820} h={400}>
            <div style={{padding: 22, display: 'flex', flexDirection: 'column', gap: 14}}>
              {queue.map((q, i) => {
                const ok = t > L[1] + 1.4 + i * 0.6;
                return (
                  <div key={q} style={{display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', background: C.surface2, borderRadius: 16}}>
                    <Icon name={i === 1 ? 'chart' : 'dm'} size={30} color={C.muted} />
                    <Txt size={25} w={700} style={{flex: 1}}>{q}</Txt>
                    <Chip size={20} color={ok ? C.bg : C.text} bg={ok ? C.accent : C.line}>{ok ? 'утверждено ✓' : 'утвердить'}</Chip>
                  </div>
                );
              })}
            </div>
          </Window>
        </Pop>
        <Pop at={L[2] - 0.1} style={{left: 960, top: 110}}>
          <Window title="журнал действий" w={860} h={400}>
            <div style={{padding: '18px 26px', fontFamily: F.mono, fontSize: 22, color: C.muted, display: 'flex', flexDirection: 'column', gap: 12}}>
              {logs.slice(0, visibleLogs).map((l) => <div key={l}><span style={{color: C.accent}}>●</span> {l}</div>)}
            </div>
          </Window>
        </Pop>
        <Pop at={L[3] - 0.1} style={{left: 100, top: 550}}>
          <div style={{display: 'flex', gap: 30}}>
            {[['Пришло заявок', C.info], ['Обработано', C.accent], ['Задерживаются', C.danger]].map(([n, col], i) => {
              const pts = Array.from({length: 12}).map((_, k) => 25 + Math.sin(k * 0.8 + i * 2) * 12 + random(`m${i}${k}`) * 8 + (i === 1 ? k * 2 : 0));
              const p = interpolate(t, [L[3] + 0.3 + i * 0.4, L[3] + 1.2 + i * 0.4], [0, 1], clamp);
              return (
                <Card key={n} style={{width: 540, height: 220, padding: 26}}>
                  <Label size={18}>{n}</Label>
                  <svg width={488} height={130} style={{marginTop: 12}}>
                    <polyline points={pts.map((v, k) => `${(k / 11) * 488 * p},${120 - v * 2}`).join(' ')} fill="none" stroke={col} strokeWidth={4} strokeLinejoin="round" />
                  </svg>
                </Card>
              );
            })}
          </div>
        </Pop>
        <Pop at={L[4] - 0.1} from="scale" style={{left: 620, top: 790}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 22, padding: '14px 26px', borderRadius: 999, background: C.surface, border: `2px solid ${C.line}`}}>
            <Txt size={22} w={700} color={auto ? C.muted : C.text}>ИИ предлагает, человек утверждает</Txt>
            <div style={{width: 74, height: 40, borderRadius: 20, background: auto ? C.accent : C.line, position: 'relative'}}>
              <div style={{position: 'absolute', top: 4, left: 4 + auto * 34, width: 32, height: 32, borderRadius: 16, background: C.text}} />
            </div>
            <Txt size={22} w={700} color={auto ? C.accent : C.muted}>автоматически</Txt>
          </div>
        </Pop>
      </Phase>
    </SceneWrap>
  );
};

const Example: React.FC = () => {
  const {L, dur} = ST('example');
  const t = useT();
  const steps: {i: IconName; t: string}[] = [
    {i: 'plane', t: 'Сообщение'}, {i: 'spark', t: 'ИИ: тема и срочность'}, {i: 'db', t: 'Карточка в CRM'},
    {i: 'user', t: 'Ответственный'}, {i: 'dm', t: 'Черновик + проверка'}, {i: 'bell', t: 'Напоминание'}, {i: 'chart', t: 'Сводка недели'},
  ];
  const stepAt = [L[0], L[1] + 0.3, L[1] + 2.2, L[2], L[3], L[4], L[5]];
  const cur = stepAt.filter((s) => t >= s - 0.1).length - 1;
  const w = 220, gap = 26, x0 = (1920 - (7 * w + 6 * gap)) / 2, y = 640;
  const all = t > L[6] - 0.1;
  const panel = (i: number) => {
    switch (i) {
      case 0: return (
        <Window title="мессенджер" w={900} h={330}>
          <div style={{padding: 30, display: 'flex', gap: 18, alignItems: 'flex-start'}}>
            <Avatar letter="О" color="#FFC23A" size={70} />
            <div style={{padding: '22px 28px', background: C.surface2, borderRadius: '8px 28px 28px 28px'}}><Txt size={32} w={600}>Нужна консультация по подключению, лучше на этой неделе.</Txt></div>
          </div>
        </Window>
      );
      case 1: return (
        <Card style={{padding: 34, width: 900, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center'}}>
          <Icon name="spark" size={54} color={C.info} />
          <Chip size={30} color={C.bg} bg={C.info}>тема: подключение</Chip>
          <Chip size={30} color={C.bg} bg={C.danger}>срочность: на этой неделе</Chip>
        </Card>
      );
      case 2: return (
        <Window title="crm · новая карточка" w={900} h={300} accent={`${C.accent}66`}>
          <div style={{padding: 30, display: 'flex', gap: 22, alignItems: 'center'}}>
            <Avatar letter="О" color="#FFC23A" size={80} />
            <div style={{flex: 1}}><Txt size={36}>Ольга</Txt><Txt size={24} w={500} color={C.muted}>Телеграм · консультация · срочно</Txt></div>
            <Chip size={24} color={C.bg} bg={C.accent}>новая</Chip>
          </div>
        </Window>
      );
      case 3: return (
        <Card style={{padding: 34, width: 900, display: 'flex', gap: 22, alignItems: 'center'}}>
          <Avatar letter="А" color={C.accent} size={86} />
          <div style={{flex: 1}}><Label size={20} color={C.accent}>ответственный по правилу «подключение»</Label><Txt size={38} style={{marginTop: 6}}>Анна · отдел продаж</Txt></div>
          <Icon name="check" size={56} color={C.accent} stroke={3} />
        </Card>
      );
      case 4: {
        const sent = t > L[3] + 3.4;
        return (
          <Window title="черновик ответа · от ИИ" w={900} h={330}>
            <div style={{padding: 30}}>
              <Txt size={28} w={600}>Ольга, здравствуйте! Спасибо за обращение. Предлагаю созвониться в четверг или пятницу — какое время удобно?</Txt>
              <div style={{display: 'flex', gap: 14, marginTop: 24}}>
                <Chip size={24} color={C.text} bg={C.surface2}>править</Chip>
                <Chip size={24} color={C.bg} bg={C.accent} style={{transform: `scale(${sent ? 1 : 1 + Math.max(0, Math.sin(t * 6)) * 0.05})`}}>{sent ? 'отправлено ✓' : 'отправить'}</Chip>
              </div>
            </div>
          </Window>
        );
      }
      case 5: return (
        <Card accent="#FFC23A" style={{padding: 34, width: 900, display: 'flex', gap: 22, alignItems: 'center'}}>
          <Icon name="bell" size={56} color="#FFC23A" />
          <div><Txt size={34}>По заявке нет движения</Txt><Txt size={24} w={500} color={C.muted}>Напоминание отправлено Анне · 18:00</Txt></div>
        </Card>
      );
      default: return (
        <Window title="сводка недели · руководителю" w={900} h={330}>
          <div style={{padding: 30, display: 'flex', gap: 30, alignItems: 'flex-end'}}>
            <div style={{display: 'flex', alignItems: 'flex-end', gap: 12, height: 200}}>
              {[50, 70, 45, 90, 65].map((h, k) => <div key={k} style={{width: 46, height: `${h}%`, borderRadius: '10px 10px 0 0', background: k === 3 ? C.accent : C.surface2}} />)}
            </div>
            <div style={{flex: 1}}><Txt size={28}>Все заявки недели</Txt><Txt size={24} w={500} color={C.muted}>по источникам, статусам и задержкам</Txt></div>
          </div>
        </Window>
      );
    }
  };
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <div style={{position: 'absolute', left: 0, right: 0, top: 120, height: 400, display: 'flex', justifyContent: 'center'}}>
        {steps.map((_, i) => (
          <Phase key={i} from={stepAt[i]} to={i < 6 ? stepAt[i + 1] : all ? L[6] : 9999} dir="left">
            <AbsoluteFill style={{alignItems: 'center', top: 0}}>{panel(i)}</AbsoluteFill>
          </Phase>
        ))}
        {all && (
          <Phase from={L[6]}>
            <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
              <KTitle lines={['сила в том,', 'что шаги связаны']} at={L[6] + 0.9} size={80} accentWords={['связаны']} />
            </AbsoluteFill>
          </Phase>
        )}
      </div>
      {steps.map((s, i) => {
        const x = x0 + i * (w + gap);
        return (
          <React.Fragment key={s.t}>
            {i > 0 && <FlowLine x1={x - gap + 2} y1={y + 75} x2={x - 2} y2={y + 75} at={stepAt[i] - 0.2} dur={0.2} width={3} packet={all} />}
            <Node x={x} y={y} w={w} icon={s.i} title={s.t} sub={`шаг ${i + 1}`} at={stepAt[i] - 0.1} active={i === cur || all} />
          </React.Fragment>
        );
      })}
    </SceneWrap>
  );
};

const Example2: React.FC = () => {
  const {L, dur} = ST('example2');
  const t = useT();
  const rows = [['Контрагент', 'ООО «Пример»', 'ООО «Пример»', true], ['Сумма', '48 000 ₽', '48 000 ₽', true], ['Срок оплаты', '15 ноября', '10 ноября', false]] as const;
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipLeft" exit="zoom">
      <div style={{position: 'absolute', left: 120, top: 110}}>
        <Kicker at={0}>пример 2 · входящие документы</Kicker>
      </div>
      <Pop at={L[1] - 0.1} from="left" style={{left: 120, top: 200}}>
        <Window title="почта · бухгалтерия" w={480} h={400}>
          <div style={{padding: 26, display: 'flex', flexDirection: 'column', gap: 16}}>
            <Txt size={26}>Счёт на оплату</Txt>
            <Txt size={20} w={500} color={C.muted}>от поставщика · вложение</Txt>
            <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, background: C.surface2}}>
              <Icon name="doc" size={44} color={C.accent} /><span style={{fontFamily: F.mono, fontSize: 21, color: C.text}}>schet_1187.pdf</span>
            </div>
          </div>
        </Window>
      </Pop>
      <FlowLine x1={610} y1={400} x2={700} y2={400} at={L[2]} dur={0.3} />
      <Pop at={L[2]} from="right" style={{left: 710, top: 200}}>
        <Window title="ИИ извлёк  ·  сверка с договором" w={1090} h={400} accent={`${C.info}66`}>
          <div style={{padding: '10px 28px'}}>
            <div style={{display: 'flex', fontFamily: F.mono, fontSize: 19, color: C.muted, height: 50, alignItems: 'center'}}>
              <div style={{width: 250}}>поле</div><div style={{width: 300}}>в счёте</div><div style={{width: 300}}>в договоре</div>
            </div>
            {rows.map(([k, a, b, ok], i) => {
              const show = t > L[2] + 0.6 + i * 0.7;
              const checked = t > L[2] + 3.2 + i * 0.4;
              return (
                <div key={k} style={{display: 'flex', alignItems: 'center', height: 92, borderTop: `2px solid ${C.line}`, opacity: show ? 1 : 0, background: !ok && t > L[3] - 0.1 ? `${C.danger}1A` : 'transparent'}}>
                  <div style={{width: 250, fontFamily: F.body, fontWeight: 800, fontSize: 27, color: C.text}}>{k}</div>
                  <div style={{width: 300, fontFamily: F.mono, fontSize: 24, color: C.text}}>{a}</div>
                  <div style={{width: 300, fontFamily: F.mono, fontSize: 24, color: C.muted}}>{b}</div>
                  {checked && <Chip size={20} color={C.bg} bg={ok ? C.accent : C.danger}>{ok ? 'совпадает' : 'расхождение'}</Chip>}
                </div>
              );
            })}
          </div>
        </Window>
      </Pop>
      <Pop at={L[2] + 4.6} style={{left: 710, top: 640}}>
        <div style={{display: 'flex', gap: 18}}>
          <Chip size={24} color={C.bg} bg={C.accent}>2 поля → в учёт автоматически</Chip>
          {t > L[3] - 0.1 && <Chip size={24} color={C.bg} bg={C.danger}>1 поле → проверяет человек</Chip>}
        </div>
      </Pop>
      {t > L[3] - 0.1 && (
        <Pop at={L[3]} style={{left: 120, top: 640}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 16}}><Avatar letter="Б" color={C.danger} size={64} /><Txt size={26} w={700}>Бухгалтер</Txt></div>
        </Pop>
      )}
    </SceneWrap>
  );
};

const Roadmap: React.FC = () => {
  const {L, dur} = ST('roadmap');
  const steps: {t: string; s: string; at: number; i: IconName}[] = [
    {t: 'Один процесс', s: 'довести до результата', at: L[0] + 0.8, i: 'flag'},
    {t: 'Замер «до»', s: 'время и потери сейчас', at: L[2], i: 'chart'},
    {t: 'Запуск', s: 'наблюдать пару недель', at: L[3], i: 'bolt'},
    {t: 'Правки', s: 'настроить правила', at: L[3] + 2.6, i: 'check'},
    {t: 'Следующий', s: 'процесс', at: L[3] + 4.6, i: 'spark'},
  ];
  const t = useT();
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <div style={{position: 'absolute', left: 120, top: 110}}>
        <KTitle lines={['Не всё сразу']} at={0.1} size={80} align="left" accentWords={['сразу']} />
      </div>
      <div style={{position: 'absolute', left: 140, top: 470, width: 1540, height: 4, background: C.line}} />
      <div style={{position: 'absolute', left: 140, top: 470, height: 4, background: C.accent, width: 1540 * interpolate(t, [steps[0].at, steps[4].at], [0, 1], clamp)}} />
      {steps.map((s, i) => (
        <Pop key={s.t} at={s.at} from="up" style={{left: 120 + i * 380, top: 380, width: 300}}>
          <div style={{width: 180, height: 180, borderRadius: 90, display: 'none'}} />
          <div style={{width: 64, height: 64, borderRadius: 32, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 0, marginTop: 26}}>
            <Icon name={s.i} size={34} color={C.bg} />
          </div>
          <Txt size={34} style={{marginTop: 26}}>{s.t}</Txt>
          <Txt size={23} w={500} color={C.muted} style={{marginTop: 6}}>{s.s}</Txt>
        </Pop>
      ))}
      <Pop at={L[1]} style={{left: 120, top: 760}}>
        <div style={{display: 'flex', gap: 16, alignItems: 'center'}}>
          <Label size={20}>хорошая первая цель:</Label>
          {['заявки', 'ответы клиентам', 'документы'].map((x) => <Chip key={x} size={24} color={C.bg} bg={C.accent}>{x}</Chip>)}
        </div>
      </Pop>
    </SceneWrap>
  );
};

const Mistakes: React.FC = () => {
  const {L, dur} = ST('mistakes');
  const items = [['Автоматизировать хаос', 'система лишь ускорит беспорядок'], ['Нет владельца', 'у автоматизации должен быть ответственный'], ['Слепое доверие ИИ', 'там, где ошибка стоит дорого']];
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipLeft" exit="zoom">
      <div style={{position: 'absolute', left: 120, top: 110}}>
        <KTitle lines={['3 частые ошибки']} at={0.1} size={80} align="left" accentWords={['ошибки']} accent={C.danger} />
      </div>
      {items.map(([a, b], i) => (
        <Pop key={a} at={L[i + 1] - 0.1} from="scale" style={{left: 120 + i * 570, top: 330, width: 530}}>
          <Card accent={`${C.danger}88`} style={{padding: 36, height: 420, display: 'flex', flexDirection: 'column', gap: 22}}>
            <div style={{width: 90, height: 90, borderRadius: 26, background: `${C.danger}22`, border: `2px solid ${C.danger}`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <svg width={44} height={44} viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" stroke={C.danger} strokeWidth={3} strokeLinecap="round" /></svg>
            </div>
            <div style={{fontFamily: F.mono, fontSize: 24, color: C.danger}}>0{i + 1}</div>
            <Txt size={40}>{a}</Txt>
            <Txt size={26} w={500} color={C.muted}>{b}</Txt>
          </Card>
        </Pop>
      ))}
    </SceneWrap>
  );
};

const Recap: React.FC = () => {
  const {L, W, dur} = ST('recap');
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="zoom">
      <div style={{position: 'absolute', left: 150, top: 260, width: 820}}>
        <Kicker at={0.1}>итог</Kicker>
        <div style={{height: 26}} />
        <KTitle lines={['Пять слоёв', 'одной системы']} at={0.2} size={84} align="left" accentWords={['одной']} />
        <Pop at={L[2]} style={{position: 'relative', marginTop: 50}}>
          <div style={{padding: '24px 30px', borderRadius: 22, background: C.surface, borderLeft: `6px solid ${C.accent}`}}>
            <Txt size={34}>Начните с одного процесса</Txt>
          </div>
        </Pop>
      </div>
      <LayerStack x={1120} y={170} times={[W('процесс'), W('данн'), W('связ'), W('ии'), W('контрол')]} />
    </SceneWrap>
  );
};

const Cta: React.FC = () => {
  const {dur} = ST('cta');
  const t = useT();
  const s = useSpring(0.3, {damping: 13});
  const b = useSpring(1.2, {damping: 12, stiffness: 160});
  return (
    <SceneWrap dur={dur + OVER} enter="zoom" exit="none">
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 40, paddingBottom: 140}}>
        <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 150, color: C.text, letterSpacing: '-0.02em', opacity: s, transform: `translateY(${(1 - s) * 50}px)`}}>BRUKINSTA</div>
        <Txt size={36} w={600} color={C.muted} style={{opacity: s}}>Разберём ваши процессы и что автоматизировать первым</Txt>
        <div style={{transform: `scale(${(0.7 + 0.3 * b) * (1 + Math.max(0, Math.sin(t * 4)) * 0.02)})`, opacity: b, padding: '30px 60px', borderRadius: 999, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 800, fontSize: 40, boxShadow: `0 0 70px ${C.accent}55`}}>НАПИСАТЬ МЕНЕДЖЕРУ →</div>
        <div style={{fontFamily: F.mono, fontSize: 30, color: C.muted, opacity: b}}>brukinsta.ru</div>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/** Верхняя навигация: где мы в структуре ролика. */
const TopNav: React.FC = () => {
  const t = useT();
  const chs = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'].map((id) => tl.scenes.find((s) => s.id === id)!.start);
  const exStart = tl.scenes.find((s) => s.id === 'chx')!.start;
  const recapStart = tl.scenes.find((s) => s.id === 'recap')!.start;
  const cur = t >= exStart ? -1 : chs.filter((c) => t >= c).length - 1;
  const show = interpolate(t, [chs[0] - 0.2, chs[0] + 0.4, recapStart - 0.3, recapStart], [0, 1, 1, 0], clamp);
  const prog = t / tl.duration;
  return (
    <>
      <div style={{position: 'absolute', left: 120, right: 120, top: 46, display: 'flex', gap: 10, opacity: show}}>
        {LAYERS.map((n, i) => (
          <div key={n} style={{flex: 1}}>
            <div style={{height: 5, borderRadius: 3, background: i === cur ? C.accent : i < cur || cur === -1 ? `${C.accent}55` : C.line}} />
            <div style={{marginTop: 8, fontFamily: F.mono, fontWeight: 700, fontSize: 18, letterSpacing: '0.08em', textTransform: 'uppercase', color: i === cur ? C.accent : C.muted}}>{`0${i + 1} ${n}`}</div>
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: 0, bottom: 0, height: 4, width: 1920 * prog, background: `${C.accent}88`}} />
    </>
  );
};

const SCENES: Record<string, React.FC> = {
  intro: Intro, promise: PromiseScene,
  ch1: () => <Chapter id="ch1" num="01" layer={0} />, procmap: ProcMap, criteria: Criteria,
  ch2: () => <Chapter id="ch2" num="02" layer={1} />, data: DataScene,
  ch3: () => <Chapter id="ch3" num="03" layer={2} />, triggers: Triggers,
  ch4: () => <Chapter id="ch4" num="04" layer={3} />, aitasks: AiTasks, aiextract: AiExtract,
  ch5: () => <Chapter id="ch5" num="05" layer={4} />, control: Control,
  chx: () => <Chapter id="chx" num="06" />, example: Example, example2: Example2,
  ch6: () => <Chapter id="ch6" num="07" />, roadmap: Roadmap, mistakes: Mistakes,
  recap: Recap, cta: Cta,
};

export const Long: React.FC = () => {
  loadFonts();
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const ch = tl.scenes.filter((s) => s.id.startsWith('ch')).map((s) => s.start);
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Bg glow={t < tl.scenes[1].start ? C.danger : C.accent} glowY={0.4} grid={64} />
      {tl.scenes.map((s, i) => {
        const Comp = SCENES[s.id];
        const from = i === 0 ? 0 : s.start - OVER;
        const to = i === tl.scenes.length - 1 ? tl.duration : s.end + OVER;
        return (
          <Sequence key={s.id} from={Math.round(from * fps)} durationInFrames={Math.round((to - from) * fps)} layout="none">
            <AbsoluteFill><Comp /></AbsoluteFill>
          </Sequence>
        );
      })}
      {ch.map((c) => <Flash key={c} at={c} color={C.accent} strength={0.12} />)}
      <TopNav />
      <Captions words={tl.words} y={950} size={42} maxWords={7} maxChars={44} width={1500} />
    </AbsoluteFill>
  );
};

export const LONG_DURATION = tl.duration;
