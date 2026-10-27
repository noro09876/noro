import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing, random} from 'remotion';
import {C, F, loadFonts} from './theme';
import {Bg, Window, Chip, Avatar, LeadCard, KTitle, Kicker, SceneWrap, Flash, Icon, FlowLine, useSpring, useT, clamp, Lead} from './components/ui';
import {Captions} from './components/Captions';
import {sceneTiming, Timeline} from './timeline';
import data from './data/short.json';

const tl = data as Timeline;
const OVER = 0.15; // перекрытие сцен для переходов, с

const LEADS: Lead[] = [
  {name: 'Ирина', src: 'Сайт', msg: 'Здравствуйте! Сколько стоит подключение?', time: '19:42', color: C.info},
  {name: 'Максим', src: 'Директ', msg: 'Можно прайс в личку?', time: '19:44', color: C.accent},
  {name: 'Ольга', src: 'Телеграм', msg: 'Есть свободное время на завтра?', time: '19:51', color: '#FFC23A'},
  {name: 'Сергей', src: 'Звонок', msg: 'Пропущенный вызов · перезвонить', time: '20:03', color: C.danger},
  {name: 'Анна К.', src: 'Сайт', msg: 'Хотим обсудить проект для команды', time: '20:10', color: C.info},
  {name: 'Денис', src: 'Директ', msg: 'Вы работаете с юрлицами?', time: '20:15', color: C.accent},
];

/* ───────────── 1. Хук ───────────── */
const Hook: React.FC = () => {
  const {L, dur} = sceneTiming(tl, 'hook');
  const t = useT();
  const sIn = useSpring(0, {damping: 13, stiffness: 180});
  const typing = t < 0.35;
  const bub = useSpring(0.35, {damping: 14, stiffness: 200});
  const fail = useSpring(L[1] - 0.05, {damping: 12, stiffness: 160});
  const shake = t > L[1] && t < L[1] + 0.35 ? Math.sin(t * 90) * 10 * (1 - (t - L[1]) / 0.35) : 0;
  // таймер «без ответа» ускоряется
  const secs = Math.max(0, t - L[1]) ** 2.6 * 2600;
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <SceneWrap dur={dur + OVER} enter="none" exit="whipUp">
      <AbsoluteFill style={{alignItems: 'center'}}>
        <div style={{position: 'absolute', top: 300, transform: `scale(${1.25 - 0.25 * sIn}) translateX(${shake}px)`, opacity: sIn}}>
          <Window title="чат · сайт" w={900} h={560}>
            <div style={{padding: 36, display: 'flex', flexDirection: 'column', gap: 22}}>
              <div style={{display: 'flex', gap: 18, alignItems: 'center'}}>
                <Avatar letter="И" size={64} />
                <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 32, color: C.text}}>Ирина</div>
                <Chip size={22} color={C.muted}>новый клиент</Chip>
              </div>
              {typing ? (
                <div style={{display: 'flex', gap: 10, padding: '26px 30px', background: C.surface2, borderRadius: 28, width: 120}}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{width: 14, height: 14, borderRadius: 9, background: C.muted, opacity: 0.4 + 0.6 * Math.abs(Math.sin(t * 9 + i))}} />
                  ))}
                </div>
              ) : (
                <div style={{alignSelf: 'flex-start', maxWidth: 700, padding: '26px 32px', background: C.surface2, borderRadius: '8px 30px 30px 30px', fontFamily: F.body, fontWeight: 600, fontSize: 38, lineHeight: 1.3, color: C.text, transform: `scale(${0.85 + 0.15 * bub})`, transformOrigin: 'top left', opacity: bub, filter: `grayscale(${fail})`}}>
                  Здравствуйте! Сколько стоит подключение? Хочу начать на этой неделе.
                </div>
              )}
              <div style={{fontFamily: F.mono, fontSize: 24, color: C.muted, opacity: bub}}>доставлено · прочитано ✓✓ 19:42</div>
            </div>
            <div style={{position: 'absolute', left: 36, right: 36, bottom: 30, height: 74, borderRadius: 20, border: `2px dashed ${fail > 0.5 ? C.danger : C.line}`, display: 'flex', alignItems: 'center', padding: '0 26px', fontFamily: F.mono, fontSize: 26, color: fail > 0.5 ? C.danger : C.muted}}>
              {fail > 0.5 ? 'ответа нет' : 'менеджер печатает…'}
            </div>
          </Window>
        </div>
        <div style={{position: 'absolute', top: 920, transform: `scale(${0.6 + 0.4 * fail})`, opacity: fail}}>
          <Chip size={40} color={C.danger} bg={`${C.danger}1F`} style={{border: `2px solid ${C.danger}66`, padding: '16px 28px'}}>
            <Icon name="clock" size={40} color={C.danger} /> без ответа {pad(hh)}:{pad(mm)}:{pad(ss)}
          </Chip>
        </div>
        <div style={{position: 'absolute', top: 1060, width: 1000}}>
          <KTitle lines={['никто', 'не ответил']} at={L[1] + 0.1} size={112} accentWords={['не', 'ответил']} accent={C.danger} stagger={0.07} />
        </div>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 2. Источники ───────────── */
const SRC: {label: string; icon: 'globe' | 'dm' | 'plane' | 'phone'; key: string}[] = [
  {label: 'Сайт', icon: 'globe', key: 'сайт'},
  {label: 'Директ', icon: 'dm', key: 'директ'},
  {label: 'Телеграм', icon: 'plane', key: 'телеграм'},
  {label: 'Звонки', icon: 'phone', key: 'звонки'},
];
const Sources: React.FC = () => {
  const {W, dur} = sceneTiming(tl, 'sources');
  const t = useT();
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipUp" exit="zoom">
      <AbsoluteFill style={{alignItems: 'center'}}>
        <div style={{position: 'absolute', top: 280}}><Kicker at={0.1}>входящие</Kicker></div>
        <div style={{position: 'absolute', top: 350, width: 1000}}>
          <KTitle lines={['заявки', 'отовсюду']} at={0.15} size={100} accentWords={['отовсюду']} />
        </div>
        {SRC.map((s, i) => {
          const at = W(s.key) - 0.12;
          const sp = useSpring(at, {damping: 12, stiffness: 200});
          const x = 75 + i * 240;
          return (
            <div key={s.label} style={{position: 'absolute', left: x, top: 640, width: 210, height: 190, borderRadius: 30, background: C.surface, border: `2px solid ${sp > 0.5 ? C.accent + '99' : C.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, transform: `translateY(${(1 - sp) * 80}px) scale(${0.7 + 0.3 * sp})`, opacity: sp, boxShadow: `0 0 ${40 * sp}px ${C.accent}22`}}>
              <Icon name={s.icon} size={64} color={C.accent} />
              <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 30, color: C.text}}>{s.label}</div>
            </div>
          );
        })}
        {/* карточки вылетают из источников и сваливаются в кучу */}
        {Array.from({length: 9}).map((_, i) => {
          const srcI = i % 4;
          const at = W(SRC[srcI].key) + 0.05 + Math.floor(i / 4) * 0.35;
          const p = interpolate(frame / fps, [at, at + 0.6], [0, 1], {...clamp, easing: Easing.bezier(0.2, 0.8, 0.3, 1)});
          if (p <= 0) return null;
          const fx = 75 + srcI * 240 + 105, fy = 735;
          const tx = 540 + (random(`x${i}`) - 0.5) * 520, ty = 1040 + (random(`y${i}`) - 0.5) * 300;
          const rot = (random(`r${i}`) - 0.5) * 34;
          const wob = Math.sin(t * 2 + i) * 1.5;
          return (
            <div key={i} style={{position: 'absolute', left: fx + (tx - fx) * p - 280, top: fy + (ty - fy) * p - 70, transform: `rotate(${rot * p + wob}deg) scale(${0.3 + 0.62 * p})`, opacity: Math.min(1, p * 3)}}>
              <LeadCard lead={LEADS[i % LEADS.length]} w={560} scale={0.85} />
            </div>
          );
        })}
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 3. Где теряются ───────────── */
const StepBadges: React.FC<{active: number}> = ({active}) => (
  <div style={{display: 'flex', gap: 14}}>
    {['01', '02', '03'].map((n, i) => (
      <div key={n} style={{width: 92, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.mono, fontWeight: 700, fontSize: 26, background: i === active ? C.danger : C.surface, color: i === active ? C.bg : i < active ? C.danger : C.muted, border: `2px solid ${i <= active ? C.danger : C.line}`}}>
        {n}
      </div>
    ))}
  </div>
);

const Beat: React.FC<{from: number; to: number; children: React.ReactNode}> = ({from, to, children}) => {
  const t = useT();
  const a = interpolate(t, [from - 0.05, from + 0.3], [0, 1], {...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const b = interpolate(t, [to - 0.2, to + 0.05], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  if (a <= 0 || b >= 1) return null;
  return <AbsoluteFill style={{transform: `translateX(${(1 - a) * 700 - b * 700}px)`, filter: `blur(${(1 - a) * 16 + b * 16}px)`, opacity: 1 - b * 0.5}}>{children}</AbsoluteFill>;
};

const Leaks: React.FC = () => {
  const {L, dur} = sceneTiming(tl, 'leaks');
  const t = useT();
  const active = t < L[1] ? 0 : t < L[2] ? 1 : 2;
  // a) личка
  const chats = ['Чат отдела продаж', 'Доставка · курьер', 'Бухгалтерия', 'Поставщик', 'Общий чат', 'Ирина · клиент'];
  const pushed = interpolate(t, [L[0] + 0.6, L[1] - 0.2], [0, 6], {...clamp, easing: Easing.in(Easing.quad)});
  // b) таблица
  const scroll = interpolate(t, [L[1] + 0.9, L[2] - 0.2], [0, 1500], {...clamp, easing: Easing.in(Easing.cubic)});
  // c) до утра
  const clockP = interpolate(t, [L[2] + 0.2, L[2] + 2.0], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const mins = 19 * 60 + 40 + clockP * (13 * 60 + 35);
  const hh = Math.floor(mins / 60) % 24, mm = Math.floor(mins % 60);
  const gone = useSpring(L[2] + 2.3, {damping: 20, stiffness: 90});
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipUp">
      <AbsoluteFill style={{alignItems: 'center'}}>
        <div style={{position: 'absolute', top: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26}}>
          <Kicker at={0} color={C.danger}>куда теряются заявки</Kicker>
          <StepBadges active={active} />
        </div>
        <Beat from={0} to={L[1]}>
          <div style={{position: 'absolute', top: 470, left: 90}}>
            <Window title="личные сообщения" w={900} h={720}>
              <div style={{position: 'absolute', inset: 0, overflow: 'hidden', padding: '20px 30px'}}>
                {chats.map((c, i) => {
                  const isLead = i === chats.length - 1;
                  const y = isLead ? Math.max(0, 0) + pushed * 104 : (i - (6 - pushed)) * 104;
                  const isNew = !isLead;
                  const appear = isNew ? interpolate(pushed, [5 - i, 6 - i], [0, 1], clamp) : 1;
                  return (
                    <div key={c} style={{position: 'absolute', left: 30, right: 30, top: 20 + y, height: 92, display: 'flex', alignItems: 'center', gap: 20, borderBottom: `2px solid ${C.line}`, opacity: isNew ? appear : 1}}>
                      <Avatar letter={c[0]} size={60} color={isLead ? C.accent : C.muted} />
                      <div style={{flex: 1, fontFamily: F.body, fontWeight: 700, fontSize: 31, color: isLead ? C.text : C.muted}}>{c}</div>
                      <div style={{minWidth: 44, height: 44, borderRadius: 22, background: isLead ? C.accent : C.surface2, color: C.bg, fontFamily: F.mono, fontWeight: 700, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{isLead ? 1 : ''}</div>
                    </div>
                  );
                })}
              </div>
            </Window>
          </div>
          <div style={{position: 'absolute', top: 1220, width: '100%'}}>
            <KTitle lines={['утонула в личке']} at={0.5} size={66} accentWords={['личке']} accent={C.danger} />
          </div>
        </Beat>
        <Beat from={L[1]} to={L[2]}>
          <div style={{position: 'absolute', top: 470, left: 90}}>
            <Window title="заявки_общая_v3_final.xlsx" w={900} h={720}>
              <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
                <div style={{transform: `translateY(${-scroll}px)`}}>
                  {Array.from({length: 26}).map((_, r) => {
                    const hl = r === 3;
                    return (
                      <div key={r} style={{display: 'flex', height: 74, borderBottom: `1px solid ${C.line}`, background: hl ? `${C.danger}22` : r % 2 ? C.surface : '#1F1E18', fontFamily: F.mono, fontSize: 23, color: hl ? C.text : C.muted, alignItems: 'center'}}>
                        <div style={{width: 80, textAlign: 'center', borderRight: `1px solid ${C.line}`, height: '100%', lineHeight: '74px', color: C.muted}}>{r + 1}</div>
                        {[hl ? 'Ирина' : ['Клиент', 'Заказ', '—', 'Звонок'][r % 4], hl ? 'сайт' : ['телефон', 'почта', 'сайт', '—'][r % 4], hl ? '???' : ['закрыт', 'в работе', '—', 'повтор'][r % 4]].map((v, k) => (
                          <div key={k} style={{flex: k === 0 ? 1.4 : 1, padding: '0 18px', borderRight: `1px solid ${C.line}`, height: '100%', lineHeight: '74px', whiteSpace: 'nowrap'}}>{v}</div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Window>
          </div>
          <div style={{position: 'absolute', top: 1220, width: '100%'}}>
            <KTitle lines={['никто не открыл']} at={L[1] + 0.4} size={66} accentWords={['не', 'открыл']} accent={C.danger} />
          </div>
        </Beat>
        <Beat from={L[2]} to={dur + 1}>
          <AbsoluteFill style={{alignItems: 'center'}}>
            <div style={{position: 'absolute', top: 470, fontFamily: F.display, fontWeight: 900, fontSize: 210, color: clockP > 0.95 ? C.danger : C.text, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums'}}>
              {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}
            </div>
            <div style={{position: 'absolute', top: 730, fontFamily: F.mono, fontSize: 30, color: C.muted}}>{clockP < 0.5 ? 'вечер · заявка ждёт' : 'утро · менеджер на месте'}</div>
            <div style={{position: 'absolute', top: 830, transform: `translateY(${gone * 160}px) rotate(${gone * -6}deg)`, opacity: 1 - gone * 0.75}}>
              <LeadCard
                lead={LEADS[0]}
                w={860}
                border={clockP > 0.95 ? C.danger : C.line}
                dim={gone}
                status={clockP > 0.95 ? <Chip size={22} color={C.bg} bg={C.danger}>клиент ушёл</Chip> : <Chip size={22} color="#FFC23A" bg="#FFC23A22">ждёт ответа</Chip>}
              />
            </div>
          </AbsoluteFill>
        </Beat>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 4. Единое окно ───────────── */
const Unify: React.FC = () => {
  const {L, dur} = sceneTiming(tl, 'unify');
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const big = useSpring(0.05, {damping: 11, stiffness: 170});
  const up = interpolate(frame / fps, [L[1] - 0.4, L[1] + 0.2], [0, 1], {...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1)});
  const win = useSpring(L[1] - 0.2);
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipUp" exit="zoom">
      <AbsoluteFill style={{alignItems: 'center'}}>
        <div style={{position: 'absolute', top: 560 - up * 300, transform: `scale(${(0.5 + 0.5 * big) * (1 - up * 0.45)})`}}>
          <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 150, color: C.accent, letterSpacing: '-0.03em', textShadow: `0 0 80px ${C.accent}55`}}>ПОРЯДОК</div>
        </div>
        <div style={{position: 'absolute', top: 470, opacity: win, transform: `translateY(${(1 - win) * 120}px)`}}>
          <Window title="все заявки · единый список" w={940} h={820} accent={`${C.accent}66`}>
            <div style={{padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 14}}>
              <div style={{display: 'flex', gap: 12, marginBottom: 6}}>
                <Chip size={22} color={C.bg} bg={C.accent}>все · {LEADS.length}</Chip>
                <Chip size={22}>новые</Chip>
                <Chip size={22}>в работе</Chip>
              </div>
              {LEADS.map((l, i) => {
                const at = L[1] + 0.05 + i * 0.16;
                const p = interpolate(frame / fps, [at, at + 0.5], [0, 1], {...clamp, easing: Easing.bezier(0.2, 0.9, 0.3, 1)});
                const fromX = (random(`ux${i}`) - 0.5) * 1400, fromY = 500 + random(`uy${i}`) * 400, rot = (random(`ur${i}`) - 0.5) * 40;
                return (
                  <div key={i} style={{display: 'flex', alignItems: 'center', gap: 18, height: 100, padding: '0 22px', borderRadius: 20, background: C.surface2, transform: `translate(${fromX * (1 - p)}px, ${fromY * (1 - p)}px) rotate(${rot * (1 - p)}deg)`, opacity: p}}>
                    <Avatar letter={l.name[0]} color={l.color} size={58} />
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 28, color: C.text}}>{l.name}</div>
                      <div style={{fontFamily: F.body, fontWeight: 500, fontSize: 23, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{l.msg}</div>
                    </div>
                    <Chip size={20}>{l.src}</Chip>
                    <Chip size={20} color={C.bg} bg={C.accent}>новая</Chip>
                  </div>
                );
              })}
            </div>
          </Window>
        </div>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 5. Ответственный, автоответ, напоминание ───────────── */
const FlowStep: React.FC<{at: number; y: number; icon: 'user' | 'bolt' | 'bell'; label: string; color?: string; children: React.ReactNode}> = ({at, y, icon, label, color = C.accent, children}) => {
  const s = useSpring(at, {damping: 14, stiffness: 170});
  return (
    <div style={{position: 'absolute', left: 80, right: 80, top: y, display: 'flex', gap: 28, alignItems: 'flex-start', opacity: s, transform: `translateX(${(1 - s) * 120}px)`}}>
      <div style={{width: 96, height: 96, borderRadius: 30, background: `${color}1F`, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 0 ${30 * s}px ${color}44`}}>
        <Icon name={icon} size={50} color={color} />
      </div>
      <div style={{flex: 1}}>
        <div style={{fontFamily: F.mono, fontWeight: 700, fontSize: 24, color, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12}}>{label}</div>
        {children}
      </div>
    </div>
  );
};

const Flow: React.FC = () => {
  const {L, dur} = sceneTiming(tl, 'flow');
  const card = useSpring(0, {damping: 15});
  const t = useT();
  const sent = t > L[1] + 0.9;
  const reminded = t > L[2] + 1.6;
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="zoom" exit="whipLeft">
      <AbsoluteFill>
        <div style={{position: 'absolute', top: 280, left: 0, right: 0, display: 'flex', justifyContent: 'center', transform: `scale(${1.3 - 0.3 * card})`, opacity: card}}>
          <LeadCard lead={LEADS[0]} w={920} border={`${C.accent}88`} status={<Chip size={22} color={C.bg} bg={C.accent}>новая</Chip>} />
        </div>
        <FlowLine x1={128} y1={505} x2={128} y2={590} at={L[0] - 0.15} dur={0.3} />
        <FlowLine x1={128} y1={686} x2={128} y2={810} at={L[1] - 0.15} dur={0.3} />
        <FlowLine x1={128} y1={906} x2={128} y2={1080} at={L[2] - 0.15} dur={0.3} />
        <FlowStep at={L[0]} y={590} icon="user" label="ответственный">
          <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
            <Avatar letter="А" color={C.accent} size={64} />
            <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 36, color: C.text}}>Анна · отдел продаж</div>
            <Icon name="check" size={44} color={C.accent} stroke={3} />
          </div>
        </FlowStep>
        <FlowStep at={L[1]} y={810} icon="bolt" label="первый ответ клиенту" color={C.info}>
          <div style={{padding: '22px 28px', background: `${C.info}1A`, border: `2px solid ${C.info}55`, borderRadius: '30px 30px 8px 30px', fontFamily: F.body, fontWeight: 600, fontSize: 30, lineHeight: 1.3, color: C.text}}>
            Здравствуйте, Ирина! Заявку получили — Анна свяжется с вами сегодня.
          </div>
          <div style={{marginTop: 12, fontFamily: F.mono, fontSize: 22, color: sent ? C.info : C.muted}}>{sent ? 'отправлено автоматически ✓' : 'отправка…'}</div>
        </FlowStep>
        <FlowStep at={L[2]} y={1080} icon="bell" label="заявка зависла" color="#FFC23A">
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 28px', background: C.surface, border: `2px solid ${reminded ? C.accent : '#FFC23A'}66`, borderRadius: 24}}>
            <div style={{fontFamily: F.body, fontWeight: 700, fontSize: 29, color: C.text}}>Нет движения по заявке</div>
            <Chip size={21} color={reminded ? C.bg : '#FFC23A'} bg={reminded ? C.accent : '#FFC23A22'}>{reminded ? 'Анне напомнили' : 'напомнить'}</Chip>
          </div>
        </FlowStep>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 6. Воронка ───────────── */
const COLS = ['Новая', 'В работе', 'Предложение', 'Сделка'];
const Pipeline: React.FC = () => {
  const {dur} = sceneTiming(tl, 'pipeline');
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const board = useSpring(0.1);
  // для каждой карточки — моменты переходов между колонками
  const cards = [
    {lead: LEADS[0], moves: [0.7, 1.5, 2.4]},
    {lead: LEADS[1], moves: [1.1, 2.0]},
    {lead: LEADS[2], moves: [1.7]},
    {lead: LEADS[3], moves: [2.6]},
    {lead: LEADS[4], moves: []},
    {lead: LEADS[5], moves: [0.9]},
  ];
  const colW = 225, gap = 14, left = (1080 - (4 * colW + 3 * gap)) / 2;
  const colOf = (moves: number[]) => {
    let c = 0;
    for (const m of moves) c += interpolate(t, [m, m + 0.45], [0, 1], {...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1)});
    return c;
  };
  // раскладка по вертикали внутри колонки
  const positions = cards.map((c) => colOf(c.moves));
  return (
    <SceneWrap dur={dur + 2 * OVER} enter="whipLeft" exit="zoom">
      <AbsoluteFill>
        <div style={{position: 'absolute', top: 270, width: '100%'}}>
          <KTitle lines={['вся воронка', 'на виду']} at={0.05} size={88} accentWords={['виду']} />
        </div>
        <div style={{position: 'absolute', top: 560, left, opacity: board, transform: `translateY(${(1 - board) * 80}px)`}}>
          {COLS.map((c, i) => (
            <div key={c} style={{position: 'absolute', left: i * (colW + gap), top: 0, width: colW, height: 560, borderRadius: 22, background: `${C.surface}CC`, border: `2px solid ${i === 3 ? C.accent + '77' : C.line}`}}>
              <div style={{padding: '18px 16px', fontFamily: F.mono, fontWeight: 700, fontSize: 21, color: i === 3 ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: '0.04em'}}>{c}</div>
            </div>
          ))}
          {cards.map((c, i) => {
            const pos = positions[i];
            const col = Math.round(pos);
            const sameCol = positions.map((p, k) => ({p: Math.round(p), k})).filter((x) => x.p === col && x.k < i).length;
            const x = pos * (colW + gap) + 10;
            const lift = Math.sin((pos % 1) * Math.PI) * 30;
            return (
              <div key={i} style={{position: 'absolute', left: x, top: 70 + sameCol * 118 - lift, width: colW - 20, height: 104, borderRadius: 16, background: C.surface2, border: `2px solid ${col === 3 ? C.accent : C.line}`, padding: '12px 14px', boxShadow: lift > 2 ? '0 20px 40px #000000AA' : 'none', transition: 'none'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <div style={{width: 12, height: 12, borderRadius: 6, background: c.lead.color}} />
                  <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 24, color: C.text}}>{c.lead.name}</div>
                </div>
                <div style={{fontFamily: F.mono, fontSize: 19, color: C.muted, marginTop: 10}}>{c.lead.src}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </SceneWrap>
  );
};

/* ───────────── 7. Финал ───────────── */
const Cta: React.FC = () => {
  const {L, dur} = sceneTiming(tl, 'cta');
  const t = useT();
  const logo = useSpring(L[1] - 0.1, {damping: 13});
  const btn = useSpring(L[1] + 0.5, {damping: 12, stiffness: 160});
  const pulse = 1 + Math.max(0, Math.sin((t - L[1]) * 4)) * 0.03 * btn;
  return (
    <SceneWrap dur={dur + OVER} enter="zoom" exit="none">
      <AbsoluteFill style={{alignItems: 'center'}}>
        <div style={{position: 'absolute', top: 300, width: 1000}}>
          <KTitle lines={['ни одна заявка', 'не должна', 'теряться']} at={0.05} size={96} accentWords={['теряться']} stagger={0.08} />
        </div>
        <div style={{position: 'absolute', top: 760, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, opacity: logo, transform: `translateY(${(1 - logo) * 60}px)`}}>
          <div style={{width: 120, height: 4, background: C.accent, borderRadius: 2, transform: `scaleX(${logo})`}} />
          <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 104, color: C.text, letterSpacing: '-0.02em'}}>BRUKINSTA</div>
          <div style={{transform: `scale(${(0.7 + 0.3 * btn) * pulse})`, opacity: btn, padding: '30px 52px', borderRadius: 999, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 800, fontSize: 38, letterSpacing: '0.01em', boxShadow: `0 0 70px ${C.accent}55`}}>
            НАПИСАТЬ МЕНЕДЖЕРУ →
          </div>
          <div style={{fontFamily: F.mono, fontSize: 30, color: C.muted, opacity: btn}}>brukinsta.ru</div>
        </div>
      </AbsoluteFill>
    </SceneWrap>
  );
};

const SCENES: Record<string, React.FC> = {hook: Hook, sources: Sources, leaks: Leaks, unify: Unify, flow: Flow, pipeline: Pipeline, cta: Cta};

export const Short: React.FC = () => {
  loadFonts();
  const {fps} = useVideoConfig();
  const t = useT();
  const unifyStart = tl.scenes.find((s) => s.id === 'unify')!.start;
  const glow = t < tl.scenes.find((s) => s.id === 'sources')!.start ? C.danger : t < unifyStart ? C.danger : C.accent;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      <Bg glow={glow} glowY={0.38} />
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
      <Flash at={unifyStart} color={C.accent} strength={0.25} />
      <Flash at={tl.scenes.find((s) => s.id === 'cta')!.start} color={C.text} strength={0.18} />
      <Captions words={tl.words} y={1395} size={62} />
    </AbsoluteFill>
  );
};

export const SHORT_DURATION = tl.duration;
