import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, F, loadFonts} from './theme';
import {Bg, Window, Chip, Avatar, Icon} from './components/ui';

/* Общая рамка слайда: шапка с брендом и пагинацией, низ с подсказкой. */
const Frame: React.FC<{n: number; children: React.ReactNode; glow?: string; glowY?: number; hint?: string}> = ({n, children, glow = C.accent, glowY = 0.4, hint}) => {
  loadFonts();
  return (
    <AbsoluteFill>
      <Bg glow={glow} glowY={glowY} />
      <div style={{position: 'absolute', left: 80, right: 80, top: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 26, color: C.text, letterSpacing: '0.02em'}}>BRUKINSTA</div>
        <div style={{display: 'flex', gap: 8}}>
          {Array.from({length: 7}).map((_, i) => (
            <div key={i} style={{width: i + 1 === n ? 34 : 10, height: 10, borderRadius: 5, background: i + 1 === n ? C.accent : C.line}} />
          ))}
        </div>
      </div>
      {children}
      {hint && (
        <div style={{position: 'absolute', right: 80, bottom: 60, fontFamily: F.mono, fontWeight: 500, fontSize: 24, color: C.muted}}>{hint}</div>
      )}
    </AbsoluteFill>
  );
};

const Num: React.FC<{n: string; style?: React.CSSProperties}> = ({n, style}) => (
  <div style={{fontFamily: F.display, fontWeight: 900, fontSize: 150, lineHeight: 0.9, color: 'transparent', WebkitTextStroke: `3px ${C.accent}`, letterSpacing: '-0.04em', ...style}}>{n}</div>
);

const H: React.FC<{children: React.ReactNode; size?: number; style?: React.CSSProperties}> = ({children, size = 64, style}) => (
  <div style={{fontFamily: F.display, fontWeight: 900, fontSize: size, lineHeight: 1.06, letterSpacing: '-0.02em', textTransform: 'uppercase', color: C.text, ...style}}>{children}</div>
);

const P: React.FC<{children: React.ReactNode; size?: number; style?: React.CSSProperties}> = ({children, size = 32, style}) => (
  <div style={{fontFamily: F.body, fontWeight: 500, fontSize: size, lineHeight: 1.4, color: C.muted, ...style}}>{children}</div>
);

const A: React.FC<{children: React.ReactNode}> = ({children}) => <span style={{color: C.accent}}>{children}</span>;

/* 1 — обложка */
export const Slide1: React.FC = () => {
  const items = ['Заявки', 'Ответы клиентам', 'Документы', 'Встречи', 'Контент', 'Отчёты', 'Базы данных'];
  return (
    <Frame n={1} glowY={0.75} hint="листайте →">
      <div style={{position: 'absolute', left: 80, right: 80, top: 190}}>
        <Chip size={26} color={C.bg} bg={C.accent} style={{fontWeight: 700}}>ИИ · автоматизация</Chip>
        <H size={96} style={{marginTop: 40}}>
          7 процессов,<br />которые <A>уже</A><br />можно отдать ИИ
        </H>
        <P size={34} style={{marginTop: 34, maxWidth: 820, color: C.text}}>Без фантастики: задачи, которые ИИ-инструменты закрывают уже сейчас. Сохраните, чтобы разобрать с командой.</P>
      </div>
      <div style={{position: 'absolute', left: 80, right: 80, bottom: 140, display: 'flex', flexWrap: 'wrap', gap: 14}}>
        {items.map((it, i) => (
          <div key={it} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderRadius: 999, background: C.surface, border: `2px solid ${C.line}`, fontFamily: F.body, fontWeight: 700, fontSize: 28, color: C.text}}>
            <span style={{fontFamily: F.mono, fontSize: 22, color: C.accent}}>0{i + 1}</span>{it}
          </div>
        ))}
      </div>
    </Frame>
  );
};

/* 2 — обработка заявок: схема-поток */
export const Slide2: React.FC = () => {
  const nodes = [
    {icon: 'dm' as const, t: 'Сообщение', s: 'сайт, мессенджер, почта'},
    {icon: 'spark' as const, t: 'ИИ разбирает', s: 'тема, срочность, контакты'},
    {icon: 'db' as const, t: 'Карточка в CRM', s: 'с источником и статусом'},
    {icon: 'user' as const, t: 'Ответственный', s: 'по правилам распределения'},
  ];
  return (
    <Frame n={2} glowY={0.2}>
      <div style={{position: 'absolute', left: 80, right: 80, top: 160, display: 'flex', alignItems: 'flex-end', gap: 30}}>
        <Num n="01" />
        <H size={58} style={{paddingBottom: 8}}>Обработка<br />входящих заявок</H>
      </div>
      <div style={{position: 'absolute', left: 80, right: 80, top: 450}}>
        {nodes.map((n, i) => (
          <div key={n.t} style={{display: 'flex', alignItems: 'center', gap: 28, height: 130, position: 'relative'}}>
            {i < nodes.length - 1 && <div style={{position: 'absolute', left: 47, top: 96, width: 4, height: 68, background: `linear-gradient(${C.accent}, ${C.accent}33)`}} />}
            <div style={{width: 98, height: 98, borderRadius: 30, background: i === 1 ? C.accent : C.surface, border: `2px solid ${i === 1 ? C.accent : C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
              <Icon name={n.icon} size={48} color={i === 1 ? C.bg : C.accent} />
            </div>
            <div>
              <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 38, color: C.text}}>{n.t}</div>
              <div style={{fontFamily: F.mono, fontSize: 25, color: C.muted, marginTop: 4}}>{n.s}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: 80, right: 80, bottom: 90, padding: '28px 32px', borderRadius: 24, background: C.surface, borderLeft: `6px solid ${C.accent}`}}>
        <P size={30} style={{color: C.text}}>Заявка не зависает в личке: у каждой есть статус и человек, который за неё отвечает.</P>
      </div>
    </Frame>
  );
};

/* 3 — ответы на типовые вопросы: чат */
export const Slide3: React.FC = () => (
  <Frame n={3} glow={C.info} glowY={0.6}>
    <div style={{position: 'absolute', left: 80, right: 80, top: 160}}>
      <Num n="02" />
      <H size={58} style={{marginTop: 20}}>Ответы на типовые<br />вопросы клиентов</H>
      <P style={{marginTop: 20, maxWidth: 860}}>ИИ-ассистент отвечает по вашей базе знаний, а сложные вопросы передаёт человеку.</P>
    </div>
    <div style={{position: 'absolute', left: 80, right: 80, top: 690}}>
      <Window title="ассистент · база знаний" w={920} h={560}>
        <div style={{padding: 30, display: 'flex', flexDirection: 'column', gap: 18}}>
          <div style={{alignSelf: 'flex-start', maxWidth: 640, padding: '18px 24px', borderRadius: '8px 26px 26px 26px', background: C.surface2, fontFamily: F.body, fontWeight: 600, fontSize: 28, color: C.text}}>Вы работаете в выходные?</div>
          <div style={{alignSelf: 'flex-end', maxWidth: 660, padding: '18px 24px', borderRadius: '26px 8px 26px 26px', background: `${C.info}22`, border: `2px solid ${C.info}55`, fontFamily: F.body, fontWeight: 600, fontSize: 28, color: C.text}}>
            Да, в субботу с 10 до 16. Записать вас?
            <div style={{fontFamily: F.mono, fontSize: 20, color: C.info, marginTop: 8}}>источник: «График работы»</div>
          </div>
          <div style={{alignSelf: 'flex-start', maxWidth: 640, padding: '18px 24px', borderRadius: '8px 26px 26px 26px', background: C.surface2, fontFamily: F.body, fontWeight: 600, fontSize: 28, color: C.text}}>А можно индивидуальные условия?</div>
          <div style={{alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 12}}>
            <Chip size={22} color={C.bg} bg="#FFC23A">передано менеджеру</Chip>
          </div>
        </div>
      </Window>
    </div>
  </Frame>
);

/* 4 — документы + встречи: split */
export const Slide4: React.FC = () => (
  <Frame n={4} glowY={0.5}>
    <div style={{position: 'absolute', left: 80, right: 80, top: 150, bottom: 80, display: 'flex', flexDirection: 'column', gap: 30}}>
      <div style={{flex: 1, borderRadius: 32, background: C.surface, border: `2px solid ${C.line}`, padding: 44, position: 'relative', overflow: 'hidden'}}>
        <div style={{display: 'flex', gap: 24, alignItems: 'center'}}>
          <Num n="03" style={{fontSize: 96}} />
          <H size={44}>Данные<br />из документов</H>
        </div>
        <div style={{display: 'flex', gap: 22, marginTop: 30, alignItems: 'center'}}>
          <div style={{width: 170, height: 210, borderRadius: 14, background: C.surface2, border: `2px solid ${C.line}`, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0}}>
            <Icon name="doc" size={40} color={C.muted} />
            {[90, 120, 70, 110, 80].map((w, i) => <div key={i} style={{width: w, height: 10, borderRadius: 5, background: i === 1 || i === 3 ? `${C.accent}AA` : C.line}} />)}
          </div>
          <div style={{fontFamily: F.display, fontSize: 40, color: C.accent}}>→</div>
          <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 10}}>
            {[['Контрагент', 'ООО «Пример»'], ['Сумма', '48 000 ₽'], ['Срок оплаты', '15.11']].map(([k, v]) => (
              <div key={k} style={{display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderRadius: 12, background: C.surface2, fontFamily: F.mono, fontSize: 23}}>
                <span style={{color: C.muted}}>{k}</span><span style={{color: C.text}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <P size={27} style={{marginTop: 22}}>Счета, акты и договоры → поля в таблицу или учётную систему. Человек проверяет, а не перепечатывает.</P>
      </div>
      <div style={{flex: 1, borderRadius: 32, background: C.surface, border: `2px solid ${C.line}`, padding: 44}}>
        <div style={{display: 'flex', gap: 24, alignItems: 'center'}}>
          <Num n="04" style={{fontSize: 96}} />
          <H size={44}>Встречи<br />и задачи</H>
        </div>
        <div style={{marginTop: 30, display: 'flex', flexDirection: 'column', gap: 12}}>
          {['Итог: согласовали макет до пятницы', 'Задача → Олег: прислать смету', 'Задача → Анна: созвон с клиентом'].map((x, i) => (
            <div key={x} style={{display: 'flex', alignItems: 'center', gap: 16, fontFamily: F.body, fontWeight: 700, fontSize: 28, color: C.text}}>
              <div style={{width: 34, height: 34, borderRadius: 10, border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? C.accent : 'transparent'}}>{i === 0 && <Icon name="check" size={24} color={C.bg} stroke={3} />}</div>
              {x}
            </div>
          ))}
        </div>
        <P size={27} style={{marginTop: 22}}>Запись созвона → краткий протокол и задачи с ответственными.</P>
      </div>
    </div>
  </Frame>
);

/* 5 — контент: веер карточек */
export const Slide5: React.FC = () => {
  const cards = [
    {t: 'Telegram', body: 'Развёрнутый пост с подзаголовками и выводом', rot: -4, x: 0, y: 40, c: C.info},
    {t: 'Instagram', body: 'Короткий текст + идеи для слайдов карусели', rot: 0, x: 315, y: 0, c: C.accent},
    {t: 'Threads', body: 'Две строки и вопрос аудитории', rot: 4, x: 630, y: 40, c: '#FFC23A'},
  ];
  return (
    <Frame n={5} glowY={0.75}>
      <div style={{position: 'absolute', left: 80, right: 80, top: 160}}>
        <Num n="05" />
        <H size={58} style={{marginTop: 20}}>Черновики контента<br />под каждую площадку</H>
        <P style={{marginTop: 20, maxWidth: 880}}>Из одной идеи — версии для разных соцсетей. Редактор доводит текст, а не пишет с нуля.</P>
      </div>
      <div style={{position: 'absolute', left: 80, top: 760, width: 920, height: 460}}>
        <div style={{position: 'absolute', left: 230, top: -70, padding: '14px 24px', borderRadius: 16, background: C.surface2, border: `2px dashed ${C.line}`, fontFamily: F.mono, fontSize: 24, color: C.text}}>идея: «куда теряются заявки»</div>
        {cards.map((c) => (
          <div key={c.t} style={{position: 'absolute', left: c.x, top: c.y + 20, width: 290, height: 400, borderRadius: 28, background: C.surface, border: `2px solid ${c.c}88`, transform: `rotate(${c.rot}deg)`, boxShadow: '0 30px 60px #000000AA', padding: 30, display: 'flex', flexDirection: 'column', gap: 16}}>
            <Chip size={22} color={C.bg} bg={c.c}>{c.t}</Chip>
            {[1, 0.8, 0.9, 0.6].map((w, i) => <div key={i} style={{height: 12, width: `${w * 100}%`, borderRadius: 6, background: C.line}} />)}
            <div style={{fontFamily: F.body, fontWeight: 700, fontSize: 25, color: C.text, marginTop: 'auto', lineHeight: 1.3}}>{c.body}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
};

/* 6 — отчёты + базы: сетка 2 колонки */
export const Slide6: React.FC = () => (
  <Frame n={6} glow={C.info} glowY={0.3}>
    <div style={{position: 'absolute', left: 80, right: 80, top: 150, bottom: 80, display: 'flex', gap: 28}}>
      <div style={{flex: 1, borderRadius: 32, background: C.surface, border: `2px solid ${C.line}`, padding: 38, display: 'flex', flexDirection: 'column'}}>
        <Num n="06" style={{fontSize: 96}} />
        <H size={40} style={{marginTop: 18}}>Отчёты<br />и сводки</H>
        <div style={{display: 'flex', alignItems: 'flex-end', gap: 12, height: 380, marginTop: 40, borderBottom: `2px solid ${C.line}`}}>
          {[40, 62, 50, 80, 58, 92].map((h, i) => <div key={i} style={{flex: 1, height: `${h}%`, borderRadius: '10px 10px 0 0', background: i === 5 ? C.accent : C.surface2}} />)}
        </div>
        <div style={{marginTop: 26, padding: '18px 20px', borderRadius: 16, background: `${C.info}1A`, border: `2px solid ${C.info}55`}}>
          <div style={{fontFamily: F.mono, fontSize: 20, color: C.info, marginBottom: 6}}>ИИ-сводка</div>
          <div style={{fontFamily: F.body, fontWeight: 600, fontSize: 24, color: C.text, lineHeight: 1.35}}>Что изменилось за неделю и на что обратить внимание</div>
        </div>
        <P size={25} style={{marginTop: 'auto'}}>Данные собираются сами, текстовый вывод — черновик для руководителя.</P>
      </div>
      <div style={{flex: 1, borderRadius: 32, background: C.surface, border: `2px solid ${C.line}`, padding: 38, display: 'flex', flexDirection: 'column'}}>
        <Num n="07" style={{fontSize: 96}} />
        <H size={40} style={{marginTop: 18}}>Чистка<br />баз данных</H>
        <div style={{marginTop: 36, display: 'flex', flexDirection: 'column', gap: 10}}>
          {[
            ['ООО Ромашка', 'ok'],
            ['ооо «Ромашка»', 'dup'],
            ['+7 900 000-00-00', 'fix'],
            ['ivan@mail', 'err'],
            ['ИП Сидоров', 'ok'],
            ['Сидоров ИП', 'dup'],
            ['8(900)0000000', 'fix'],
            ['anna@company.ru', 'ok'],
          ].map(([v, s]) => (
            <div key={v} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px', borderRadius: 12, background: C.surface2, fontFamily: F.mono, fontSize: 21, color: s === 'dup' ? C.muted : C.text, textDecoration: s === 'dup' ? 'line-through' : undefined}}>
              {v}
              <Chip size={17} color={s === 'ok' ? C.bg : s === 'err' ? C.bg : C.text} bg={s === 'ok' ? C.accent : s === 'err' ? C.danger : C.line}>{{ok: 'ок', dup: 'дубль', fix: 'формат', err: 'ошибка'}[s]}</Chip>
            </div>
          ))}
        </div>
        <P size={25} style={{marginTop: 'auto'}}>Дубли, ошибки в контактах и разный формат записей находятся до того, как испортят рассылку.</P>
      </div>
    </div>
  </Frame>
);

/* 7 — финал: с чего начать */
export const Slide7: React.FC = () => {
  const steps = [
    ['Выберите один процесс', 'частый, повторяющийся, с понятными правилами'],
    ['Опишите, как он идёт сейчас', 'кто, что и в какой момент делает'],
    ['Автоматизируйте шаг за шагом', 'и оставьте человека там, где нужна проверка'],
  ];
  return (
    <Frame n={7} glowY={0.85}>
      <div style={{position: 'absolute', left: 80, right: 80, top: 170}}>
        <H size={84}>С чего<br /><A>начать?</A></H>
        <div style={{marginTop: 54, display: 'flex', flexDirection: 'column', gap: 22}}>
          {steps.map(([t, s], i) => (
            <div key={t} style={{display: 'flex', gap: 28, alignItems: 'center', padding: '28px 30px', borderRadius: 26, background: C.surface, border: `2px solid ${C.line}`}}>
              <div style={{width: 76, height: 76, borderRadius: 22, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 900, fontSize: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>{i + 1}</div>
              <div>
                <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 34, color: C.text}}>{t}</div>
                <div style={{fontFamily: F.body, fontWeight: 500, fontSize: 26, color: C.muted, marginTop: 4}}>{s}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{position: 'absolute', left: 80, right: 80, bottom: 90, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div style={{fontFamily: F.body, fontWeight: 700, fontSize: 28, color: C.text, lineHeight: 1.35}}>Сохраните карусель<br /><span style={{color: C.muted, fontWeight: 500}}>и отправьте коллеге</span></div>
        <div style={{padding: '24px 34px', borderRadius: 999, background: C.accent, color: C.bg, fontFamily: F.display, fontWeight: 800, fontSize: 26}}>НАПИСАТЬ МЕНЕДЖЕРУ</div>
      </div>
    </Frame>
  );
};

export const SLIDES = [Slide1, Slide2, Slide3, Slide4, Slide5, Slide6, Slide7];
