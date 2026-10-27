import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, F, loadFonts} from './theme';
import {Bg, Window, Chip, Avatar, Icon, LeadCard} from './components/ui';

const Brand: React.FC<{top?: number}> = ({top = 250}) => (
  <div style={{position: 'absolute', left: 90, right: 90, top, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
    <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 30, color: C.text}}>BRUKINSTA</div>
    <Chip size={24} color={C.muted}>заявки · автоматизация</Chip>
  </div>
);

const H: React.FC<{children: React.ReactNode; size?: number; style?: React.CSSProperties}> = ({children, size = 96, style}) => (
  <div style={{fontFamily: F.display, fontWeight: 900, fontSize: size, lineHeight: 1.05, letterSpacing: '-0.02em', textTransform: 'uppercase', color: C.text, ...style}}>{children}</div>
);

/* Stories 1 — опрос */
export const Story1: React.FC = () => {
  loadFonts();
  const opts = [
    {t: 'В личных сообщениях', i: 'dm' as const},
    {t: 'В таблицах', i: 'table' as const},
    {t: 'В пропущенных звонках', i: 'phone' as const},
    {t: 'Не теряются — всё под контролем', i: 'check' as const},
  ];
  return (
    <AbsoluteFill>
      <Bg glow={C.danger} glowY={0.3} />
      <Brand />
      <div style={{position: 'absolute', left: 90, right: 90, top: 420}}>
        <Chip size={28} color={C.bg} bg={C.accent} style={{fontWeight: 700}}>опрос</Chip>
        <H style={{marginTop: 36}}>Где у вас<br />чаще <span style={{color: C.danger}}>теряются</span><br />заявки?</H>
      </div>
      <div style={{position: 'absolute', left: 90, right: 90, top: 1000, display: 'flex', flexDirection: 'column', gap: 22}}>
        {opts.map((o, k) => (
          <div key={o.t} style={{display: 'flex', alignItems: 'center', gap: 26, padding: '30px 34px', borderRadius: 30, background: C.surface, border: `2px solid ${k === 3 ? C.accent + '88' : C.line}`}}>
            <Icon name={o.i} size={52} color={k === 3 ? C.accent : C.danger} />
            <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 40, color: C.text}}>{o.t}</div>
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 300, textAlign: 'center', fontFamily: F.mono, fontSize: 28, color: C.muted}}>ответьте в стикере — разберём результаты</div>
    </AbsoluteFill>
  );
};

/* Stories 2 — 3 признака */
export const Story2: React.FC = () => {
  loadFonts();
  const signs = [
    ['Клиенты пишут повторно', '«Вы получили моё сообщение?»'],
    ['Нельзя быстро сказать, сколько заявок пришло', 'за день, неделю или из рекламы'],
    ['Заявки живут в телефонах менеджеров', 'уходит сотрудник — уходит переписка'],
  ];
  return (
    <AbsoluteFill>
      <Bg glow={C.accent} glowY={0.7} />
      <Brand />
      <div style={{position: 'absolute', left: 90, right: 90, top: 420}}>
        <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 220, lineHeight: 0.9, color: 'transparent', WebkitTextStroke: `4px ${C.accent}`}}>3</div>
        <H size={84} style={{marginTop: 20}}>признака,<br />что заявки<br /><span style={{color: C.danger}}>утекают</span></H>
      </div>
      <div style={{position: 'absolute', left: 90, right: 90, top: 1120, display: 'flex', flexDirection: 'column', gap: 24}}>
        {signs.map(([t, s], i) => (
          <div key={t} style={{display: 'flex', gap: 26, alignItems: 'flex-start', padding: '30px 32px', borderRadius: 30, background: C.surface, border: `2px solid ${C.line}`}}>
            <div style={{width: 64, height: 64, borderRadius: 20, background: `${C.danger}22`, border: `2px solid ${C.danger}`, color: C.danger, fontFamily: F.display, fontWeight: 900, fontSize: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>{i + 1}</div>
            <div>
              <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 38, color: C.text, lineHeight: 1.2}}>{t}</div>
              <div style={{fontFamily: F.body, fontWeight: 500, fontSize: 30, color: C.muted, marginTop: 8}}>{s}</div>
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* Stories 3 — анонс ролика */
export const Story3: React.FC = () => {
  loadFonts();
  return (
    <AbsoluteFill>
      <Bg glow={C.accent} glowY={0.45} />
      <Brand />
      <div style={{position: 'absolute', left: 90, right: 90, top: 400}}>
        <Chip size={28} color={C.bg} bg={C.accent} style={{fontWeight: 700}}>новый ролик</Chip>
        <H size={92} style={{marginTop: 36}}>Куда теряются<br /><span style={{color: C.accent}}>заявки</span></H>
        <div style={{fontFamily: F.body, fontWeight: 600, fontSize: 36, color: C.muted, marginTop: 24, lineHeight: 1.35}}>и как автоматизация наводит порядок. Коротко и по делу.</div>
      </div>
      <div style={{position: 'absolute', left: 140, top: 990, transform: 'rotate(-3deg)'}}>
        <Window title="чат · сайт" w={800} h={520}>
          <div style={{padding: 34, display: 'flex', flexDirection: 'column', gap: 20}}>
            <div style={{display: 'flex', gap: 16, alignItems: 'center'}}>
              <Avatar letter="И" size={60} />
              <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 32, color: C.text}}>Ирина</div>
            </div>
            <div style={{padding: '24px 28px', background: C.surface2, borderRadius: '8px 28px 28px 28px', fontFamily: F.body, fontWeight: 600, fontSize: 34, color: C.text, lineHeight: 1.3}}>Здравствуйте! Сколько стоит подключение?</div>
            <Chip size={30} color={C.danger} bg={`${C.danger}1F`} style={{alignSelf: 'flex-start', border: `2px solid ${C.danger}66`}}>
              <Icon name="clock" size={32} color={C.danger} /> без ответа 14:32:08
            </Chip>
          </div>
        </Window>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 1580, display: 'flex', justifyContent: 'center'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 20, padding: '30px 50px', borderRadius: 999, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 800, fontSize: 38}}>
          <svg width="34" height="34" viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill={C.bg} /></svg>
          СМОТРЕТЬ В ПРОФИЛЕ
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* Обложка Reels */
export const ReelCover: React.FC = () => {
  loadFonts();
  return (
    <AbsoluteFill>
      <Bg glow={C.danger} glowY={0.55} />
      <div style={{position: 'absolute', left: 80, right: 80, top: 360, textAlign: 'center'}}>
        <H size={128}>Куда<br /><span style={{color: C.danger}}>теряются</span><br />заявки?</H>
      </div>
      <div style={{position: 'absolute', left: 110, top: 1010, transform: 'rotate(-7deg)', opacity: 0.45}}>
        <LeadCard lead={{name: 'Максим', src: 'Директ', msg: 'Можно прайс в личку?', time: '19:44', color: C.accent}} w={760} dim={0.6} />
      </div>
      <div style={{position: 'absolute', left: 180, top: 1110, transform: 'rotate(4deg)'}}>
        <LeadCard lead={{name: 'Ирина', src: 'Сайт', msg: 'Здравствуйте! Сколько стоит подключение?', time: '19:42', color: C.info}} w={780} border={C.danger} status={<Chip size={22} color={C.bg} bg={C.danger}>без ответа</Chip>} />
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 1420, textAlign: 'center', fontFamily: F.display, fontWeight: 900, fontSize: 34, color: C.text}}>BRUKINSTA</div>
    </AbsoluteFill>
  );
};
